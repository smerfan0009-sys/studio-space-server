import "dotenv/config";
import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from environment variables.");
}

const client = new MongoClient(process.env.MONGODB_URI);

export const db = client.db("studio_space");

let connectionPromise = null;

export async function connectToMongoDB() {
  if (!connectionPromise) {
    connectionPromise = client.connect().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  await connectionPromise;
  return db;
}
