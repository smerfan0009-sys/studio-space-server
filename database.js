import "dotenv/config";
import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env");
}

const client = new MongoClient(process.env.MONGODB_URI);

export const db = client.db("studio_space");

let isConnected = false;

export async function connectToMongoDB() {
  if (isConnected) return;

  await client.connect();
  isConnected = true;

  console.log("Successfully connected to MongoDB!");
}