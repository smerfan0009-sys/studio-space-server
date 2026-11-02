import "dotenv/config";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);

export const db = client.db("studio_space");

export async function connectToMongoDB() {
  await client.connect();
  console.log("Successfully connected to MongoDB!");
}