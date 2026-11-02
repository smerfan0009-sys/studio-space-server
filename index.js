import express from "express";
import cors from "cors";
import "dotenv/config";
import { ObjectId } from "mongodb";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

import { auth } from "./auth.js";
import { db, connectToMongoDB } from "./database.js";

const app = express();
const PORT = process.env.PORT || 7000;

const studiosCollection = db.collection("studios");

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

async function getAuthenticatedUser(req) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  return session?.user || null;
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "StudioSpace server is running fine!",
  });
});

app.get("/api/studios", async (req, res) => {
  try {
    const studios = await studiosCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      studios,
    });
  } catch (error) {
    console.error("Fetch studios error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load studios.",
    });
  }
});

app.get("/api/studios/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID.",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!studio) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    res.status(200).json({
      success: true,
      studio,
    });
  } catch (error) {
    console.error("Fetch studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load studio details.",
    });
  }
});

app.get("/api/my-listings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to view your studio listings.",
      });
    }

    const studios = await studiosCollection
      .find({
        $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      studios,
    });
  } catch (error) {
    console.error("Fetch listings error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load studio listings.",
    });
  }
});

app.post("/api/studios", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to create a studio.",
      });
    }

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
      typeof title !== "string" ||
      !title.trim() ||
      typeof category !== "string" ||
      !category.trim() ||
      hourlyRate === undefined ||
      securityDeposit === undefined ||
      capacity === undefined ||
      typeof location !== "string" ||
      !location.trim() ||
      typeof imageUrl !== "string" ||
      !imageUrl.trim() ||
      typeof overview !== "string" ||
      !overview.trim()
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

    let parsedImageUrl;

    try {
      parsedImageUrl = new URL(imageUrl.trim());
    } catch {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid image URL.",
      });
    }

    if (!["http:", "https:"].includes(parsedImageUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: "Image URL must use HTTP or HTTPS.",
      });
    }

    if (overview.trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: "Studio overview must contain at least 30 characters.",
      });
    }

    const newStudio = {
      title: title.trim(),
      category: category.trim(),
      hourlyRate: rate,
      securityDeposit: deposit,
      capacity: maxCapacity,
      location: location.trim(),
      imageUrl: parsedImageUrl.toString(),
      amenities: Array.isArray(amenities) ? amenities : [],
      overview: overview.trim(),

      ownerId: user.id,
      ownerName: user.name || "",
      ownerEmail: user.email,

      rating: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await studiosCollection.insertOne(newStudio);

    res.status(201).json({
      success: true,
      message: "Studio created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create studio.",
    });
  }
});

app.delete("/api/studios/:id", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to delete a studio.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID.",
      });
    }

    const result = await studiosCollection.deleteOne({
      _id: new ObjectId(id),
      $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Studio not found or you are not the owner.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Studio deleted successfully!",
    });
  } catch (error) {
    console.error("Delete studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete studio.",
    });
  }
});

async function startServer() {
  try {
    await connectToMongoDB();

    app.listen(PORT, () => {
      console.log(`StudioSpace server is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
