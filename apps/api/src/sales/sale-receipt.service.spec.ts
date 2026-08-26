import { SaleReceiptService, WhatsAppService } from './sale-receipt.service';
import { dec } from '../purchases/purchase-calc';

describe('SaleReceiptService', () => {
  const service = new SaleReceiptService({} as never);

  it('builds receipt payload with payment breakdown and debt', () => {
    const payload = service.buildPayload({
      sale: {
        number: 'S-00001',
        totalAmountKgs: dec('44000'),
        paidAmountKgs: dec('30000'),
        debtAmountKgs: dec('14000'),
        confirmedAt: new Date('2026-08-15T14:25:00Z'),
        soldBy: { name: 'Бакыт' },
        client: { name: 'Асан' },
        items: [
          {
            quantity: dec('2'),
            unitPriceKgs: dec('13000'),
            lineTotalKgs: dec('26000'),
            product: { name: 'Контроллер', code: 'PRD-0001' },
          },
        ],
        payments: [
          { amountKgs: dec('10000'), paymentMethod: { name: 'Наличные' } },
          { amountKgs: dec('20000'), paymentMethod: { name: 'MBank' } },
        ],
      },
      clientTypeLabel: 'Оптовый',
      clientCategoryLabel: 'VIP',
      clientTotalDebtKgs: dec('35000'),
      receiptNumber: 'R-00001',
    });

    expect(payload.businessName).toBe('EMOTORS');
    expect(payload.totalAmountKgs).toBe('44000');
    expect(payload.paidAmountKgs).toBe('30000');
    expect(payload.debtAmountKgs).toBe('14000');
    expect(payload.payments).toHaveLength(2);
    expect(payload.clientTotalDebtKgs).toBe('35000');
  });

  it('formats receipt text with required sections', () => {
    const payload = service.buildPayload({
      sale: {
        number: 'S-00001',
        totalAmountKgs: dec('44000'),
        paidAmountKgs: dec('30000'),
        debtAmountKgs: dec('14000'),
        confirmedAt: new Date('2026-08-15T14:25:00Z'),
        soldBy: { name: 'Бакыт' },
        client: { name: 'Асан' },
        items: [
          {
            quantity: dec('2'),
            unitPriceKgs: dec('13000'),
            lineTotalKgs: dec('26000'),
            product: { name: 'Контроллер', code: 'PRD-0001' },
          },
        ],
        payments: [
          { amountKgs: dec('10000'), paymentMethod: { name: 'Наличные' } },
          { amountKgs: dec('20000'), paymentMethod: { name: 'MBank' } },
        ],
      },
      clientTypeLabel: 'Оптовый',
      clientCategoryLabel: 'VIP',
      clientTotalDebtKgs: dec('35000'),
      receiptNumber: 'R-00001',
    });

    const text = service.formatReceiptText(payload);
    expect(text).toContain('EMOTORS');
    expect(text).toContain('Чек №R-00001');
    expect(text).toContain('Клиент: Асан');
    expect(text).toContain('Тип: Оптовый');
    expect(text).toContain('Категория: VIP');
    expect(text).toContain('Наличные');
    expect(text).toContain('MBank');
    expect(text).toContain('Долг по продаже:   14000');
    expect(text).toContain('Общий долг клиента: 35000 KGS');
  });
});

describe('WhatsAppService', () => {
  const whatsapp = new WhatsAppService();

  it('builds share URL when phone is present', () => {
    const url = whatsapp.buildShareUrl('+996 555 123 456', 'Test receipt');
    expect(url).toContain('https://wa.me/996555123456');
    expect(url).toContain(encodeURIComponent('Test receipt'));
  });

  it('returns null when phone is missing', () => {
    expect(whatsapp.buildShareUrl('', 'Test')).toBeNull();
    expect(whatsapp.buildShareUrl('123', 'Test')).toBeNull();
  });
});
