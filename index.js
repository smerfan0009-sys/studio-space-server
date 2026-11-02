import express from "express";
import cors from "cors";
import "dotenv/config";
import { ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { db, connectToMongoDB } from "./database.js";

const app = express();
const PORT = process.env.PORT || 7000;

let studiosCollection;

const client = new MongoClient(process.env.MONGODB_URI);

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

// MongoDB connection
async function connectToMongoDB() {
  await client.connect();

  console.log("Successfully connected to MongoDB!");

  const db = client.db("studio_space");
  studiosCollection = db.collection("studios");
}

// Home route
app.get("/", (req, res) => {
  res.send({
    success: true,
    message: "StudioSpace server is running fine!",
  });
});

// Get my studio listings
// IMPORTANT: Authentication must be configured before returning private listings.
app.get("/api/my-listings", async (req, res) => {
  try {
    // JWT authentication is not configured yet.
    // Do not return every user's studio as a workaround.
    return res.status(401).json({
      success: false,
      message: "Please log in to view your studio listings.",
    });
  } catch (error) {
    console.error("Fetch listings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load studio listings.",
    });
  }
});

// Create a new studio
app.post("/api/studios", async (req, res) => {
  try {
    const {
      title,
      category,
      hourlyRate,
      securityDeposit,
      capacity,
      location,
      imageUrl,
      amenities,
      overview,
    } = req.body;

    if (
      !title ||
      !category ||
      hourlyRate === undefined ||
      securityDeposit === undefined ||
      capacity === undefined ||
      !location ||
      !imageUrl ||
      !overview
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required studio information.",
      });
    }

    const rate = Number(hourlyRate);
    const deposit = Number(securityDeposit);
    const maxCapacity = Number(capacity);

    if (
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !Number.isFinite(deposit) ||
      deposit < 0 ||
      !Number.isInteger(maxCapacity) ||
      maxCapacity < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid pricing and capacity values.",
      });
    }

    if (
      typeof imageUrl !== "string" ||
      !/^https?:\/\/\S+$/i.test(imageUrl.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid image URL.",
      });
    }

    if (typeof overview !== "string" || overview.trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: "Studio overview must contain at least 30 characters.",
      });
    }

    const newStudio = {
      title: title.trim(),
      category,
      hourlyRate: rate,
      securityDeposit: deposit,
      capacity: maxCapacity,
      location: location.trim(),
      imageUrl: imageUrl.trim(),
      amenities: Array.isArray(amenities) ? amenities : [],
      overview: overview.trim(),

      // These will be populated from the verified user session.
      ownerName: null,
      ownerEmail: null,

      rating: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await studiosCollection.insertOne(newStudio);

    return res.status(201).json({
      success: true,
      message: "Studio created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create studio error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create studio.",
    });
  }
});

// Delete studio
// This route will be implemented with verified owner authentication.
app.delete("/api/studios/:id", async (req, res) => {
  return res.status(401).json({
    success: false,
    message: "Please log in to delete a studio.",
  });
});

// Start server after MongoDB connection
async function startServer() {
  try {
    await connectToMongoDB();

    studiosCollection = db.collection("studios");

    app.listen(PORT, () => {
      console.log(`StudioSpace server is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

// middlewares

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// Better Auth route must come before express.json()
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

export default app;
