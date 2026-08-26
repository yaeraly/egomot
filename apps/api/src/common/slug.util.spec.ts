import { slugifyCategoryName } from './slug.util';

describe('slugifyCategoryName', () => {
  it('generates stable latin slug from cyrillic', () => {
    expect(slugifyCategoryName('Моторы')).toBe('motory');
    expect(slugifyCategoryName('Тормозная система')).toBe('tormoznaya-sistema');
    expect(slugifyCategoryName('Зарядные устройства')).toBe('zaryadnye-ustroystva');
  });
});
