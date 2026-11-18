import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { RefreshTokenDto } from './refresh-token.dto';
import { TokenDto } from './token.dto';
import { LoginDto } from './login.dto';
import { EmailRequestDto } from './email-request.dto';
import {
  AccountQueryDto,
  AccountRoleUpdateDto,
  AccountStatusUpdateDto,
  InternalAccountCreateDto,
} from './account.dto';

// Đăng ký hợp lệ theo RegisterRequest của API Contract v1.0.2: phone là bắt buộc.
const registration = {
  email: 'user@example.com',
  fullName: 'Test User',
  phone: '0901234567',
  password: 'StrongPass@123',
};

describe('Auth DTO validation', () => {
  it.each([
    'StrongPass@123 bad',
    'StrongPass@123\n',
    'StrongPass@123#',
    'short1!',
    'lowercase123!',
    'UPPERCASE123!',
    'NoDigitsHere!',
    'NoSpecial123',
    'Aa1!' + 'a'.repeat(125),
  ])('rejects invalid complete password %j', (password) => {
    for (const [Dto, body] of [
      [RegisterDto, { ...registration, password }],
      [ResetPasswordDto, { token: 't', password, passwordConfirmation: password }],
    ] as const) {
      expect(validateSync(plainToInstance(Dto as typeof RegisterDto, body)).length).toBeGreaterThan(0);
    }
  });

  it.each(['Aa1!aaaa', 'Aa1!' + 'a'.repeat(124)])('accepts password boundaries', (password) => {
    expect(validateSync(plainToInstance(RegisterDto, { ...registration, password }))).toEqual([]);
  });

  it.each(['0901234567', '+84901234567', '123456789'])(
    'accepts the contract phone pattern %s',
    (phone) => {
      expect(validateSync(plainToInstance(RegisterDto, { ...registration, phone }))).toEqual([]);
    },
  );

  it.each(['0901234567x', '0901234567\n', '123', 901234567])(
    'rejects malformed phone %#',
    (phone) => {
      expect(
        validateSync(plainToInstance(RegisterDto, { ...registration, phone })).length,
      ).toBeGreaterThan(0);
    },
  );

  it('requires phone on registration because RegisterRequest marks it required', () => {
    const withoutPhone = {
      email: registration.email,
      fullName: registration.fullName,
      password: registration.password,
    };
    expect(validateSync(plainToInstance(RegisterDto, withoutPhone)).length).toBeGreaterThan(0);
  });

  it.each(['', 123, null, []])('requires a string token %#', (token) => {
    expect(validateSync(plainToInstance(TokenDto, { token })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(RefreshTokenDto, { refreshToken: token })).length).toBeGreaterThan(0);
  });

  it('requires passwordConfirmation on the reset request', () => {
    expect(
      validateSync(plainToInstance(ResetPasswordDto, { token: 't', password: 'StrongPass@123' }))
        .length,
    ).toBeGreaterThan(0);
  });

  // LoginRequest dùng identifier, không dùng email riêng; rememberMe là boolean tuỳ chọn.
  it('accepts identifier login with optional rememberMe', () => {
    expect(
      validateSync(
        plainToInstance(LoginDto, { identifier: 'khach@example.com', password: 'MatKhauMinhHoa!2026' }),
      ),
    ).toEqual([]);
    expect(
      validateSync(
        plainToInstance(LoginDto, {
          identifier: '0901234567',
          password: 'MatKhauMinhHoa!2026',
          rememberMe: true,
        }),
      ),
    ).toEqual([]);
  });

  it.each([{}, { identifier: '' }, { identifier: 'x', password: '' }])(
    'rejects incomplete login %#',
    (body) => {
      expect(validateSync(plainToInstance(LoginDto, body)).length).toBeGreaterThan(0);
    },
  );

  it('rejects non-boolean rememberMe', () => {
    expect(
      validateSync(plainToInstance(LoginDto, { identifier: 'a', password: 'b', rememberMe: 'yes' }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('accepts only a valid email on EmailRequest', () => {
    expect(validateSync(plainToInstance(EmailRequestDto, { email: 'khach@example.com' }))).toEqual([]);
    expect(validateSync(plainToInstance(EmailRequestDto, { email: 'not-an-email' })).length).toBeGreaterThan(0);
  });

  // AccountQueryDto: page/limit phải transform từ query string và clamp đúng biên contract.
  it('transforms and validates pagination bounds', () => {
    expect(validateSync(plainToInstance(AccountQueryDto, { page: '2', limit: '100' }))).toEqual([]);
    expect(validateSync(plainToInstance(AccountQueryDto, { limit: '101' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(AccountQueryDto, { page: '0' })).length).toBeGreaterThan(0);
  });

  it('accepts the contract role filter and a search keyword', () => {
    expect(validateSync(plainToInstance(AccountQueryDto, { q: 'Nguyễn', role: 'STAFF' }))).toEqual([]);
    expect(validateSync(plainToInstance(AccountQueryDto, { role: 'ROOT' })).length).toBeGreaterThan(0);
  });

  // Optimistic locking: version >= 1 bắt buộc, reason bắt buộc cho audit.
  it('requires version and reason on account mutations', () => {
    expect(
      validateSync(plainToInstance(AccountRoleUpdateDto, { version: '3', role: 'STAFF', reason: 'Bổ nhiệm' })),
    ).toEqual([]);
    expect(
      validateSync(plainToInstance(AccountRoleUpdateDto, { role: 'STAFF', reason: 'x' })).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(plainToInstance(AccountRoleUpdateDto, { version: '3', role: 'CUSTOMER', reason: 'x' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(plainToInstance(AccountStatusUpdateDto, { version: '3', status: 'LOCKED', reason: 'Gian lận' })),
    ).toEqual([]);
    expect(
      validateSync(plainToInstance(AccountStatusUpdateDto, { version: '3', status: 'BLOCKED', reason: 'x' }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('restricts internal account creation to STAFF and ADMIN', () => {
    const base = { fullName: 'Nhân viên', email: 'staff@example.com', password: 'MatKhauNoiBo!2026' };
    expect(validateSync(plainToInstance(InternalAccountCreateDto, { ...base, role: 'STAFF' }))).toEqual([]);
    expect(
      validateSync(plainToInstance(InternalAccountCreateDto, { ...base, role: 'CUSTOMER' })).length,
    ).toBeGreaterThan(0);
  });
});
