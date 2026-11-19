// Cấu hình Jest riêng cho E2E: chỉ chạy các file *.e2e-spec.ts trong tests/.
// Tách khỏi cấu hình unit trong package.json để `npm test` không chạy e2e (giống CI của Leader).
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: String.raw`\.e2e-spec\.ts$`,
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  // E2E dựng nhiều Nest app; chạy tuần tự để tránh tranh chấp biến môi trường.
  maxWorkers: 1,
};
