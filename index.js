import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 7000;

import { MongoClient } from "mongodb";

const client = new MongoClient(
  process.env.MONGODB_URI,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

connectToMongoDB()








// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL, // Replace with your client URL
    credentials: true,
  }),
);

app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.send({
    message: "StudioSpace server is running fine!",
  });
});

// Server
app.listen(PORT, () => {
  console.log(`StudioSpace server is running at ${PORT}`);
});

export default app;
