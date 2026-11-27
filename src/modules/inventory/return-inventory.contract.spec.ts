import { BadRequestException } from '@nestjs/common';

import {
  buildReturnOperationKey,
  validateReturnReceiptQuantities,
} from './return-inventory.contract';

import type {
  ReturnReceiptKind,
  ReturnReceiptQuantityInput,
} from './return-inventory.contract';

const MAX_INT = 2147483647;

function expectValidationError(
  action: () => unknown,
): void {
  try {
    action();
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }

    expect(error.getStatus()).toBe(400);

    expect(error.getResponse()).toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    return;
  }

  throw new Error(
    'Expected VALIDATION_ERROR was not thrown',
  );
}

function customer(
  receivedQuantity: number,
  acceptedQuantity: number,
  resalableQuantity: number,
): ReturnReceiptQuantityInput {
  return {
    kind: 'CUSTOMER_RETURN',
    receivedQuantity,
    acceptedQuantity,
    resalableQuantity,
  };
}

function delivery(
  receivedQuantity: number,
  resalableQuantity: number,
): ReturnReceiptQuantityInput {
  return {
    kind: 'DELIVERY_RETURN',
    receivedQuantity,
    resalableQuantity,
  };
}

describe('Return Inventory Contract', () => {
  describe('Customer return quantities', () => {
    it('RC-01: returns only resalable quantity', () => {
      expect(
        validateReturnReceiptQuantities(
          customer(5, 4, 3),
        ),
      ).toBe(3);
    });

    it('RC-02: accepts all received items as resalable', () => {
      expect(
        validateReturnReceiptQuantities(
          customer(5, 5, 5),
        ),
      ).toBe(5);
    });

    it('RC-03: accepts non-resalable returned items', () => {
      expect(
        validateReturnReceiptQuantities(
          customer(5, 4, 0),
        ),
      ).toBe(0);
    });

    it('RC-04: accepts zero quantity classification', () => {
      expect(
        validateReturnReceiptQuantities(
          customer(0, 0, 0),
        ),
      ).toBe(0);
    });
  });

  describe('Delivery return quantities', () => {
    it('RC-05: returns resalable delivery quantity', () => {
      expect(
        validateReturnReceiptQuantities(
          delivery(5, 3),
        ),
      ).toBe(3);
    });

    it('RC-06: accepts damaged delivery returns', () => {
      expect(
        validateReturnReceiptQuantities(
          delivery(5, 0),
        ),
      ).toBe(0);
    });

    it('RC-07: accepts maximum supported integer', () => {
      expect(
        validateReturnReceiptQuantities(
          delivery(MAX_INT, MAX_INT),
        ),
      ).toBe(MAX_INT);
    });
  });

  describe('Invalid return receipt quantities', () => {
    const invalidCases: Array<{
      name: string;
      input: unknown;
    }> = [
      {
        name: 'RC-08: rejects null',
        input: null,
      },
      {
        name: 'RC-09: rejects undefined',
        input: undefined,
      },
      {
        name: 'RC-10: rejects primitive input',
        input: 'invalid',
      },
      {
        name: 'RC-11: rejects unknown receipt kind',
        input: {
          kind: 'UNKNOWN',
          receivedQuantity: 5,
          resalableQuantity: 3,
        },
      },
      {
        name: 'RC-12: rejects negative received quantity',
        input: customer(-1, 0, 0),
      },
      {
        name: 'RC-13: rejects fractional received quantity',
        input: customer(5.5, 4, 3),
      },
      {
        name: 'RC-14: rejects NaN received quantity',
        input: customer(Number.NaN, 4, 3),
      },
      {
        name: 'RC-15: rejects infinite received quantity',
        input: customer(Number.POSITIVE_INFINITY, 4, 3),
      },
      {
        name: 'RC-16: rejects received quantity overflow',
        input: customer(MAX_INT + 1, 4, 3),
      },
      {
        name: 'RC-17: rejects string received quantity',
        input: {
          ...customer(5, 4, 3),
          receivedQuantity: '5',
        },
      },
      {
        name: 'RC-18: rejects negative resalable quantity',
        input: customer(5, 4, -1),
      },
      {
        name: 'RC-19: rejects fractional resalable quantity',
        input: customer(5, 4, 2.5),
      },
      {
        name: 'RC-20: rejects resalable quantity overflow',
        input: delivery(MAX_INT, MAX_INT + 1),
      },
      {
        name: 'RC-21: rejects string resalable quantity',
        input: {
          ...customer(5, 4, 3),
          resalableQuantity: '3',
        },
      },
      {
        name: 'RC-22: rejects negative accepted quantity',
        input: customer(5, -1, 0),
      },
      {
        name: 'RC-23: rejects fractional accepted quantity',
        input: customer(5, 3.5, 3),
      },
      {
        name: 'RC-24: rejects missing accepted quantity',
        input: {
          kind: 'CUSTOMER_RETURN',
          receivedQuantity: 5,
          resalableQuantity: 3,
        },
      },
      {
        name: 'RC-25: rejects accepted quantity above received',
        input: customer(5, 6, 3),
      },
      {
        name: 'RC-26: rejects resalable above accepted',
        input: customer(5, 3, 4),
      },
      {
        name: 'RC-27: rejects delivery resalable above received',
        input: delivery(5, 6),
      },
    ];

    it.each(invalidCases)('$name', ({ input }) => {
      expectValidationError(() =>
        validateReturnReceiptQuantities(
          input as ReturnReceiptQuantityInput,
        ),
      );
    });
  });

  describe('Valid operation keys', () => {
    it('RK-01: creates customer return operation key', () => {
      expect(
        buildReturnOperationKey(
          'CUSTOMER_RETURN',
          15,
        ),
      ).toBe(
        'M03-RETURN-RECEIPT-ITEM-15-RESTOCK',
      );

      expect(
        buildReturnOperationKey(
          'CUSTOMER_RETURN',
          MAX_INT,
        ),
      ).toBe(
        `M03-RETURN-RECEIPT-ITEM-${MAX_INT}-RESTOCK`,
      );
    });

    it('RK-02: creates delivery return operation key', () => {
      expect(
        buildReturnOperationKey(
          'DELIVERY_RETURN',
          15,
        ),
      ).toBe(
        'M03-DELIVERY-RETURN-ITEM-15-RESTOCK',
      );
    });

    it('RK-03: generates stable keys for replay', () => {
      const first = buildReturnOperationKey(
        'CUSTOMER_RETURN',
        15,
      );

      const second = buildReturnOperationKey(
        'CUSTOMER_RETURN',
        15,
      );

      expect(first).toBe(second);
    });

    it('RK-04: separates receipt kinds and item IDs', () => {
      const keys = [
        buildReturnOperationKey(
          'CUSTOMER_RETURN',
          15,
        ),
        buildReturnOperationKey(
          'CUSTOMER_RETURN',
          16,
        ),
        buildReturnOperationKey(
          'DELIVERY_RETURN',
          15,
        ),
        buildReturnOperationKey(
          'DELIVERY_RETURN',
          16,
        ),
      ];

      expect(new Set(keys).size).toBe(4);
    });
  });

  describe('Invalid operation keys', () => {
    const invalidIds: Array<{
      name: string;
      id: unknown;
    }> = [
      {
        name: 'RK-05: rejects zero ID',
        id: 0,
      },
      {
        name: 'RK-06: rejects negative ID',
        id: -1,
      },
      {
        name: 'RK-07: rejects fractional ID',
        id: 1.5,
      },
      {
        name: 'RK-08: rejects NaN ID',
        id: Number.NaN,
      },
      {
        name: 'RK-09: rejects infinite ID',
        id: Number.POSITIVE_INFINITY,
      },
      {
        name: 'RK-10: rejects ID overflow',
        id: MAX_INT + 1,
      },
      {
        name: 'RK-11: rejects string ID',
        id: '15',
      },
      {
        name: 'RK-12: rejects missing ID',
        id: undefined,
      },
    ];

    it.each(invalidIds)('$name', ({ id }) => {
      expectValidationError(() =>
        buildReturnOperationKey(
          'CUSTOMER_RETURN',
          id as number,
        ),
      );
    });

    it('RK-13: rejects unknown receipt kind', () => {
      expectValidationError(() =>
        buildReturnOperationKey(
          'UNKNOWN' as ReturnReceiptKind,
          15,
        ),
      );
    });
  });
});
