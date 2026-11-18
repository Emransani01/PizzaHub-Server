/**
 * Development-only demo seed.
 *
 * Creates two vendors, one customer and a handful of menu items so the public
 * pages and dashboards have real MongoDB documents to work with. Nothing here
 * is required for production, and it never touches transaction records: in
 * production Premium is granted only by the verified Stripe webhook.
 *
 * Run with: npm run seed:demo
 */
import { getAuth } from "../lib/auth.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { findUserByEmail, updateUser } from "../lib/user-repository.js";
import { MenuItemModel } from "../modules/menu-items/menu-item.model.js";
import { Types } from "mongoose";

const DEMO_PASSWORD = "Demo1234";

interface DemoUser {
  email: string;
  name: string;
  businessName?: string;
  role: "vendor" | "customer";
  premium?: boolean;
}

const demoUsers: DemoUser[] = [
  {
    email: "vendor@pizzahub.demo",
    name: "Napoli Oven",
    businessName: "Napoli Oven",
    role: "vendor",
  },
  {
    email: "premium@pizzahub.demo",
    name: "Golden Crust",
    businessName: "Golden Crust",
    role: "vendor",
    premium: true,
  },
  {
    email: "customer@pizzahub.demo",
    name: "Demo Customer",
    role: "customer",
  },
];

const demoItems = [
  {
    vendorEmail: "vendor@pizzahub.demo",
    itemName: "Margherita Pizza",
    category: "Classic Pizzas",
    description:
      "San Marzano tomato, fresh mozzarella and basil on a hand-tossed, stone-baked crust.",
    price: 12.99,
    location: "Naples, FL",
    images: ["/images/home/margherita.jpg"],
    status: "approved",
    isAvailable: true,
  },
  {
    vendorEmail: "vendor@pizzahub.demo",
    itemName: "Veggie Delight",
    category: "Vegetarian Pizzas",
    description:
      "Roasted peppers, mushrooms, tomato and herbs over stretchy mozzarella.",
    price: 13.99,
    location: "Naples, FL",
    images: ["/images/home/veggie.jpg"],
    status: "approved",
    isAvailable: true,
  },
  {
    vendorEmail: "vendor@pizzahub.demo",
    itemName: "Garlic Bread Bites",
    category: "Sides & Appetizers",
    description:
      "Golden baked dough bites brushed with garlic butter and parmesan.",
    price: 5.99,
    location: "Naples, FL",
    images: ["/images/home/category-sides.jpg"],
    status: "approved",
    isAvailable: true,
  },
  {
    vendorEmail: "vendor@pizzahub.demo",
    itemName: "Truffle Mushroom Pizza",
    category: "Specialty / Gourmet Pizzas",
    description:
      "Wild mushrooms, truffle cream and aged parmesan. Awaiting admin approval.",
    price: 18.5,
    location: "Naples, FL",
    images: ["/images/home/category-pizzas.jpg"],
    status: "pending",
    isAvailable: true,
  },
  {
    vendorEmail: "premium@pizzahub.demo",
    itemName: "Pepperoni Pizza",
    category: "Meat Lovers",
    description:
      "Crispy-edged pepperoni, bubbling cheese and our signature tomato sauce.",
    price: 14.99,
    location: "Fort Myers, FL",
    images: ["/images/home/pepperoni.jpg"],
    status: "approved",
    isAvailable: true,
  },
  {
    vendorEmail: "premium@pizzahub.demo",
    itemName: "BBQ Chicken Pizza",
    category: "Specialty / Gourmet Pizzas",
    description:
      "Smoky barbecue chicken, red onion, coriander and a sweet-smoky glaze.",
    price: 15.99,
    location: "Fort Myers, FL",
    images: ["/images/home/bbq-chicken.jpg"],
    status: "approved",
    isAvailable: true,
  },
  {
    vendorEmail: "premium@pizzahub.demo",
    itemName: "Chocolate Fudge Cake",
    category: "Beverages & Desserts",
    description:
      "Warm chocolate layer cake with a molten fudge centre and vanilla cream.",
    price: 6.49,
    location: "Fort Myers, FL",
    images: ["/images/home/category-desserts.jpg"],
    status: "approved",
    isAvailable: true,
  },
];

async function ensureUser(spec: DemoUser): Promise<string> {
  const existing = await findUserByEmail(spec.email);

  if (existing) {
    await updateUser(existing.id, {
      role: spec.role,
      roleOnboarded: true,
      businessName: spec.businessName ?? null,
      ...(spec.premium
        ? {
            subscriptionPlan: "premium" as const,
            subscriptionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          }
        : {}),
    });
    return existing.id;
  }

  const result = await getAuth().api.signUpEmail({
    body: {
      email: spec.email,
      password: DEMO_PASSWORD,
      name: spec.name,
    },
  });

  const userId = (result as { user?: { id?: string } } | undefined)?.user?.id;
  if (!userId) {
    throw new Error(`Could not create demo user ${spec.email}.`);
  }

  await updateUser(userId, {
    role: spec.role,
    roleOnboarded: true,
    businessName: spec.businessName ?? null,
    ...(spec.premium
      ? {
          subscriptionPlan: "premium" as const,
          subscriptionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        }
      : {}),
  });

  return userId;
}

async function main(): Promise<void> {
  await connectDatabase();

  const vendorIds = new Map<string, string>();
  for (const user of demoUsers) {
    const id = await ensureUser(user);
    vendorIds.set(user.email, id);
  }

  for (const item of demoItems) {
    const vendorId = vendorIds.get(item.vendorEmail);
    if (!vendorId) continue;

    await MenuItemModel.findOneAndUpdate(
      {
        vendorId: new Types.ObjectId(vendorId),
        itemName: item.itemName,
      },
      {
        $set: {
          vendorId: new Types.ObjectId(vendorId),
          itemName: item.itemName,
          category: item.category,
          description: item.description,
          price: item.price,
          location: item.location,
          images: item.images,
          status: item.status,
          isAvailable: item.isAvailable,
          rejectionReason: null,
        },
      },
      { upsert: true, new: true },
    );
  }

  console.log("");
  console.log("=================================================");
  console.log(" PizzaHub demo data seeded");
  console.log("-------------------------------------------------");
  console.log(` Vendor A:      vendor@pizzahub.demo  / ${DEMO_PASSWORD}  (free plan)`);
  console.log(` Vendor B:      premium@pizzahub.demo / ${DEMO_PASSWORD}  (premium)`);
  console.log(` Customer:      customer@pizzahub.demo / ${DEMO_PASSWORD}`);
  console.log("=================================================");
  console.log("");

  await disconnectDatabase();
}

main().catch(async (error: unknown) => {
  console.error("Demo seed failed.", error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
