export const MENU_CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export const MENU_CATEGORY_DESCRIPTIONS: Record<MenuCategory, string> = {
  "Classic Pizzas": "Timeless stone-baked favourites",
  "Vegetarian Pizzas": "Garden-fresh toppings, no meat",
  "Meat Lovers": "Loaded with cured and grilled meats",
  "Specialty / Gourmet Pizzas": "Chef-led builds and premium toppings",
  "Sides & Appetizers": "Shareable bites, dips and garlic breads",
  "Beverages & Desserts": "Cool sips and sweet finishes",
};

const slugs = [
  "classic-pizzas",
  "vegetarian-pizzas",
  "meat-lovers",
  "specialty-gourmet-pizzas",
  "sides-appetizers",
  "beverages-desserts",
] as const;

/**
 * Stable, human-friendly slugs used by the homepage category cards so the
 * browse page can be deep-linked without leaking encoded spaces or slashes.
 */
export const MENU_CATEGORY_SLUGS: Record<MenuCategory, string> = {
  "Classic Pizzas": slugs[0],
  "Vegetarian Pizzas": slugs[1],
  "Meat Lovers": slugs[2],
  "Specialty / Gourmet Pizzas": slugs[3],
  "Sides & Appetizers": slugs[4],
  "Beverages & Desserts": slugs[5],
};

export function categoryFromSlug(slug: string): MenuCategory | null {
  const match = (Object.entries(MENU_CATEGORY_SLUGS) as [MenuCategory, string][]).find(
    ([, value]) => value === slug,
  );
  return match ? match[0] : null;
}

export function isMenuCategory(value: unknown): value is MenuCategory {
  return (
    typeof value === "string" &&
    (MENU_CATEGORIES as readonly string[]).includes(value)
  );
}
