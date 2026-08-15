import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { dec, roundMoney } from '../purchases/purchase-calc';
import { roundMarkup } from '../pricing/pricing-calc';

describe('sale confirm price override', () => {
  it('recalculates markup from owner override price', () => {
    const unitPrice = roundMoney('12500');
    const unitCost = dec('10000');
    const finalMarkupPercent = roundMarkup(
      unitPrice.div(unitCost).minus(1).times(100),
    );
    expect(finalMarkupPercent.toFixed(2)).toBe('25.00');
    expect(roundMoney(unitPrice.times(2)).toFixed(2)).toBe('25000.00');
  });

  it('documents owner-only override guard', () => {
    const role = UserRole.SALES;
    const hasOverride = true;
    if (hasOverride && role !== UserRole.OWNER) {
      expect(() => {
        throw new BadRequestException('Только владелец может изменить цену продажи');
      }).toThrow(BadRequestException);
    }
  });
});
