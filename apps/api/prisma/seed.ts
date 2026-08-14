import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OWNER_EMAIL ?? 'owner@egomot.local';
  const password = process.env.OWNER_PASSWORD ?? 'Owner123!';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Владелец',
      role: UserRole.OWNER,
    },
  });

  const categories = ['Одежда', 'Обувь', 'Электроника', 'Хозтовары', 'Прочее'];
  for (const name of categories) {
    await prisma.productCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded OWNER ${email} and ${categories.length} categories`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
