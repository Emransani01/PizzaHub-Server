import { randomBytes } from "node:crypto";
import { env } from "../config/environment.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { getAuth } from "../lib/auth.js";
import { findUserByEmail, updateUser } from "../lib/user-repository.js";

function generatePassword(): string {
  // Guarantees the required uppercase, lowercase, digit and symbol mix.
  return `Aa1!${randomBytes(9).toString("base64url")}`;
}

async function main(): Promise<void> {
  if (!env.admin.email) {
    console.error(
      "ADMIN_EMAIL is not set. Add ADMIN_EMAIL (and optionally ADMIN_NAME) to server/.env, then run this script again.",
    );
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  const email = env.admin.email.toLowerCase();
  const password = env.admin.password || generatePassword();
  const generated = !env.admin.password;

  const existing = await findUserByEmail(email);

  if (existing) {
    await updateUser(existing.id, {
      role: "admin",
      roleOnboarded: true,
      isBlocked: false,
    });

    console.log("Admin role ensured for existing account:", email);
    if (generated) {
      console.log(
        "This account already had a password, so it was left unchanged. " +
          "Delete the user and re-run the seed if you need a fresh password.",
      );
    }
    await disconnectDatabase();
    return;
  }

  const result = await getAuth().api.signUpEmail({
    body: {
      email,
      password,
      name: env.admin.name,
    },
  });

  const userId =
    (result as { user?: { id?: string } } | undefined)?.user?.id ?? null;

  if (userId) {
    await updateUser(userId, {
      role: "admin",
      roleOnboarded: true,
      isBlocked: false,
    });
  }

  console.log("");
  console.log("=================================================");
  console.log(" PizzaHub admin account created");
  console.log("-------------------------------------------------");
  console.log(` Email:    ${email}`);
  console.log(` Password: ${password}`);
  console.log("=================================================");
  console.log(
    "Store this password securely. It is printed once and is not saved anywhere.",
  );
  console.log("");

  await disconnectDatabase();
}

main().catch(async (error: unknown) => {
  console.error("Admin seed failed.", error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
