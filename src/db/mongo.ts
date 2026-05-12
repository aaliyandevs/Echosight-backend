import { Db, MongoClient } from "mongodb";
import { env } from "../config";

let client: MongoClient | null = null;
let db: Db | null = null;

export const connectToMongo = async (): Promise<void> => {
  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB_NAME);
  await ensureIndexes();
};

export const getDb = (): Db => {
  if (!db) {
    throw new Error("MongoDB is not initialized");
  }
  return db;
};

export const pingMongo = async (): Promise<boolean> => {
  if (!db) {
    return false;
  }

  try {
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
};

export const closeMongo = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
};

const ensureIndexes = async (): Promise<void> => {
  const database = getDb();

  await database.collection("users").createIndex({ user_id: 1 }, { unique: true });
  await database
    .collection("users")
    .createIndex({ email: 1 }, { unique: true, sparse: true });
  await database
    .collection("refresh_tokens")
    .createIndex({ token_hash: 1 }, { unique: true });
  await database
    .collection("refresh_tokens")
    .createIndex({ user_id: 1, expires_at: 1 });
  await database.collection("refresh_tokens").createIndex(
    { expires_at: 1 },
    {
      expireAfterSeconds: 0,
    }
  );
  await database
    .collection("devices")
    .createIndex({ user_id: 1, device_id: 1 }, { unique: true });
  await database
    .collection("alert_profiles")
    .createIndex({ user_id: 1 }, { unique: true });
  await database.collection("sound_events").createIndex({ user_id: 1, ts: -1 });
  await database
    .collection("model_versions")
    .createIndex({ platform: 1, channel: 1, version: -1 });
  await database
    .collection("idempotency_keys")
    .createIndex({ user_id: 1, route: 1, key: 1 }, { unique: true });
  await database.collection("idempotency_keys").createIndex(
    { created_at: 1 },
    {
      expireAfterSeconds: 60 * 60 * 24,
    }
  );
};
