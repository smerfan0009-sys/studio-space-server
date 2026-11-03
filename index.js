import express from "express";
import cors from "cors";
import "dotenv/config";
import { ObjectId } from "mongodb";
import multer from "multer";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

import { auth } from "./auth.js";
import { db, connectToMongoDB } from "./database.js";

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 7000;

const studiosCollection = db.collection("studios");
const bookingsCollection = db.collection("bookings");
const reviewsCollection = db.collection("reviews");
const newsletterCollection = db.collection("newsletter");

// --------------------------------------------------
// DATABASE INITIALIZATION
// --------------------------------------------------

let initializationPromise = null;

async function initializeServer() {
  await connectToMongoDB();

  await reviewsCollection.createIndex({ bookingId: 1 }, { unique: true });

  await reviewsCollection.createIndex({
    studioId: 1,
    createdAt: -1,
  });

  await bookingsCollection.createIndex({
    studioId: 1,
    status: 1,
    startTime: 1,
    endTime: 1,
  });
}

async function ensureServerInitialized(req, res, next) {
  try {
    if (!initializationPromise) {
      initializationPromise = initializeServer().catch((error) => {
        initializationPromise = null;
        throw error;
      });
    }

    await initializationPromise;
    next();
  } catch (error) {
    console.error("Server initialization error:", error);

    return res.status(503).json({
      success: false,
      message: "Server is temporarily unavailable. Please try again.",
    });
  }
}

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WebP and GIF images are allowed."));
    }

    cb(null, true);
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://studio-space-nine.vercel.app",
    credentials: true,
  }),
);

// IMPORTANT: Initialization must run before every API route.
app.use(ensureServerInitialized);

// Keep Better Auth before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

async function getAuthenticatedUser(req) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  return session?.user || null;
}

function isStudioOwner(studio, user) {
  return Boolean(
    studio &&
    user &&
    (studio.ownerId === user.id ||
      (studio.ownerEmail &&
        studio.ownerEmail.toLowerCase() === user.email?.toLowerCase())),
  );
}

function serializeBooking(booking) {
  return {
    ...booking,
    _id: String(booking._id),
    studioId: booking.studioId ? String(booking.studioId) : "",
  };
}

function getBookingStudioObjectId(booking) {
  if (!booking?.studioId) return null;

  const id = String(booking.studioId);

  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value.trim());
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function studioNotAvailable(res) {
  return res.status(404).json({
    success: false,
    message: "This studio is no longer available.",
  });
}

// --------------------------------------------------
// SERVER STATUS
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "StudioSpace server is running fine!",
  });
});

// --------------------------------------------------
// NEWSLETTER
// --------------------------------------------------

app.post("/api/newsletter", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    await newsletterCollection.updateOne(
      { email },
      {
        $setOnInsert: {
          email,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(201).json({
      success: true,
      message: "You are subscribed. Watch your inbox for studio inspiration!",
    });
  } catch (error) {
    console.error("Newsletter subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to subscribe. Please try again.",
    });
  }
});

// --------------------------------------------------
// IMAGE UPLOAD
// --------------------------------------------------

app.post(
  "/api/upload-image",
  async (req, res, next) => {
    try {
      const user = await getAuthenticatedUser(req);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Please log in to upload an image.",
        });
      }

      next();
    } catch (error) {
      console.error("Image upload authentication error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to verify authentication.",
      });
    }
  },
  (req, res, next) => {
    imageUpload.single("image")(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message || "Image upload failed.",
        });
      }

      next();
    });
  },
  async (req, res) => {
    try {
      if (!process.env.IMGBB_API_KEY) {
        return res.status(500).json({
          success: false,
          message: "Image upload service is not configured.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select an image.",
        });
      }

      const formData = new URLSearchParams();

      formData.append("image", req.file.buffer.toString("base64"));
      formData.append("name", `studiospace-${Date.now()}`);

      const uploadResponse = await fetch(
        `https://api.imgbb.com/1/upload?key=${encodeURIComponent(
          process.env.IMGBB_API_KEY,
        )}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const result = await uploadResponse.json();

      if (!uploadResponse.ok || !result.success) {
        console.error("ImgBB upload error:", result);

        return res.status(502).json({
          success: false,
          message: "Image hosting service failed to upload the image.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Image uploaded successfully!",
        imageUrl: result.data.display_url,
      });
    } catch (error) {
      console.error("Image upload error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to upload image.",
      });
    }
  },
);

// --------------------------------------------------
// GET ALL AVAILABLE STUDIOS
// --------------------------------------------------

app.get("/api/studios", async (req, res) => {
  try {
    const studios = await studiosCollection
      .find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      studios,
    });
  } catch (error) {
    console.error("Fetch studios error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load studios.",
    });
  }
});

// --------------------------------------------------
// GET FEATURED STUDIOS
// --------------------------------------------------

app.get("/api/studios/featured", async (req, res) => {
  try {
    const studios = await studiosCollection
      .find({ isDeleted: { $ne: true } })
      .sort({ rating: -1, createdAt: -1 })
      .limit(6)
      .toArray();

    return res.status(200).json({
      success: true,
      total: studios.length,
      studios,
    });
  } catch (error) {
    console.error("Fetch featured studios error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load studios.",
    });
  }
});

// --------------------------------------------------
// GET REVIEWS FOR A STUDIO
// --------------------------------------------------

app.get("/api/studios/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID.",
      });
    }

    const studioId = new ObjectId(id);

    const reviews = await reviewsCollection
      .find({ studioId })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: reviews.length,
      reviews: reviews.map((review) => ({
        ...review,
        _id: String(review._id),
        bookingId: String(review.bookingId),
        studioId: String(review.studioId),
      })),
    });
  } catch (error) {
    console.error("Fetch reviews error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reviews.",
    });
  }
});

// --------------------------------------------------
// GET ONE AVAILABLE STUDIO
// --------------------------------------------------

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
      isDeleted: { $ne: true },
    });

    if (!studio) {
      return res.status(404).json({
        success: false,
        message: "Studio not found or no longer available.",
      });
    }

    return res.status(200).json({
      success: true,
      studio,
    });
  } catch (error) {
    console.error("Fetch studio error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load studio details.",
    });
  }
});

// --------------------------------------------------
// GET CURRENT USER'S ACTIVE LISTINGS
// --------------------------------------------------

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
        isDeleted: { $ne: true },
        $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      studios,
    });
  } catch (error) {
    console.error("Fetch listings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load studio listings.",
    });
  }
});

// --------------------------------------------------
// CREATE BOOKING
// --------------------------------------------------

app.post("/api/bookings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to book a studio.",
      });
    }

    const { studioId, startTime, endTime } = req.body || {};

    if (!studioId || !ObjectId.isValid(studioId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID.",
      });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (
      !startTime ||
      !endTime ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid booking dates and times.",
      });
    }

    if (start <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Booking must be scheduled for a future time.",
      });
    }

    if (end <= start) {
      return res.status(400).json({
        success: false,
        message: "End time must be after start time.",
      });
    }

    const durationInHours =
      (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    if (durationInHours < 1) {
      return res.status(400).json({
        success: false,
        message: "Minimum booking duration is 1 hour.",
      });
    }

    const studioObjectId = new ObjectId(studioId);

    const studio = await studiosCollection.findOne({
      _id: studioObjectId,
      isDeleted: { $ne: true },
    });

    if (!studio) {
      return studioNotAvailable(res);
    }

    if (isStudioOwner(studio, user)) {
      return res.status(403).json({
        success: false,
        message: "You cannot book your own studio.",
      });
    }

    const hourlyRate = Number(studio.hourlyRate);

    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      return res.status(400).json({
        success: false,
        message: "This studio has an invalid hourly rate.",
      });
    }

    const totalAmount = Math.round(hourlyRate * durationInHours * 100) / 100;

    const conflictingBooking = await bookingsCollection.findOne({
      studioId: { $in: [studioObjectId, studioObjectId.toString()] },
      status: /^confirmed$/i,
      startTime: { $lt: end },
      endTime: { $gt: start },
    });

    if (conflictingBooking) {
      return res.status(409).json({
        success: false,
        message: "This studio is already booked for the selected time.",
      });
    }

    const now = new Date();

    const newBooking = {
      studioId: studioObjectId,
      userId: user.id,
      userEmail: user.email,
      userName: user.name || "",
      studioTitle: studio.title,
      studioImage: studio.imageUrl || "",
      category: studio.category || "",
      location: studio.location || "",
      startTime: start,
      endTime: end,
      hourlyRate,
      durationInHours,
      totalAmount,
      status: "Pending",
      createdAt: now,
      updatedAt: now,
    };

    const result = await bookingsCollection.insertOne(newBooking);

    return res.status(201).json({
      success: true,
      message: "Booking request submitted successfully!",
      booking: serializeBooking({
        ...newBooking,
        _id: result.insertedId,
      }),
    });
  } catch (error) {
    console.error("Create booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create booking.",
    });
  }
});

// --------------------------------------------------
// GET CUSTOMER'S BOOKINGS
// --------------------------------------------------

app.get("/api/my-bookings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to view your bookings.",
      });
    }

    const bookings = await bookingsCollection
      .find({
        $or: [{ userId: user.id }, { userEmail: user.email }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    const validStudioIds = [
      ...new Set(
        bookings
          .map((booking) => booking.studioId)
          .filter(Boolean)
          .map((id) => String(id))
          .filter((id) => ObjectId.isValid(id)),
      ),
    ].map((id) => new ObjectId(id));

    const studios = validStudioIds.length
      ? await studiosCollection.find({ _id: { $in: validStudioIds } }).toArray()
      : [];

    const studioMap = new Map(
      studios.map((studio) => [String(studio._id), studio]),
    );

    const formattedBookings = bookings.map((booking) => {
      const studio = studioMap.get(String(booking.studioId));
      const studioUnavailable = !studio || studio.isDeleted === true;

      const studioTitle = studioUnavailable
        ? booking.studioTitle || "Studio Unavailable"
        : studio.title || booking.studioTitle || "Studio";

      const studioImageUrl = studioUnavailable
        ? booking.studioImage || ""
        : studio.imageUrl || booking.studioImage || "";

      const studioLocation = studioUnavailable
        ? booking.location || ""
        : studio.location || booking.location || "";

      return {
        ...serializeBooking(booking),
        studioUnavailable,
        studioTitle,
        studioImageUrl,
        studioLocation,
        studio: {
          _id: booking.studioId ? String(booking.studioId) : "",
          title: studioTitle,
          imageUrl: studioImageUrl,
          location: studioLocation,
          isDeleted: studioUnavailable,
        },
      };
    });

    return res.status(200).json({
      success: true,
      total: formattedBookings.length,
      bookings: formattedBookings,
    });
  } catch (error) {
    console.error("Fetch my bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your bookings.",
    });
  }
});

// --------------------------------------------------
// GET HOST'S BOOKING REQUESTS
// --------------------------------------------------

app.get("/api/host-bookings", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to view booking requests.",
      });
    }

    const ownedStudios = await studiosCollection
      .find({
        $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
      })
      .project({ _id: 1 })
      .toArray();

    const studioIds = ownedStudios.map((studio) => studio._id);

    if (studioIds.length === 0) {
      return res.status(200).json({
        success: true,
        total: 0,
        bookings: [],
      });
    }

    const bookings = await bookingsCollection
      .find({
        studioId: { $in: studioIds },
      })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: bookings.length,
      bookings: bookings.map(serializeBooking),
    });
  } catch (error) {
    console.error("Fetch host bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load host bookings.",
    });
  }
});

// --------------------------------------------------
// HOST CONFIRMS BOOKING
// --------------------------------------------------

app.patch("/api/bookings/:id/confirm", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to confirm bookings.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    const studioObjectId = getBookingStudioObjectId(booking);

    if (!studioObjectId) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: studioObjectId,
    });

    if (!studio || !isStudioOwner(studio, user)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to confirm this booking.",
      });
    }

    if (studio.isDeleted === true) {
      return studioNotAvailable(res);
    }

    if (!/^pending$/i.test(booking.status || "")) {
      return res.status(409).json({
        success: false,
        message: "Only pending bookings can be confirmed.",
      });
    }

    const conflictingBooking = await bookingsCollection.findOne({
      _id: { $ne: booking._id },
      studioId: {
        $in: [studioObjectId, studioObjectId.toString()],
      },
      status: /^confirmed$/i,
      startTime: { $lt: new Date(booking.endTime) },
      endTime: { $gt: new Date(booking.startTime) },
    });

    if (conflictingBooking) {
      return res.status(409).json({
        success: false,
        message:
          "This time slot overlaps another confirmed booking. You cannot confirm it.",
      });
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: booking._id,
        status: /^pending$/i,
      },
      {
        $set: {
          status: "Confirmed",
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).json({
        success: false,
        message: "Booking status changed. Refresh and try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking confirmed successfully.",
    });
  } catch (error) {
    console.error("Confirm booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to confirm booking.",
    });
  }
});

// --------------------------------------------------
// HOST REJECTS BOOKING
// --------------------------------------------------

app.patch("/api/bookings/:id/reject", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to manage bookings.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    const studioId = getBookingStudioObjectId(booking);

    if (!studioId) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: studioId,
    });

    if (!studio || !isStudioOwner(studio, user)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to reject this booking.",
      });
    }

    if (studio.isDeleted === true) {
      return studioNotAvailable(res);
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: booking._id,
        status: /^pending$/i,
      },
      {
        $set: {
          status: "Cancelled",
          rejectedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).json({
        success: false,
        message: "Only pending bookings can be rejected.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking request rejected.",
    });
  } catch (error) {
    console.error("Reject booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject booking.",
    });
  }
});

// --------------------------------------------------
// HOST MARKS BOOKING COMPLETED
// --------------------------------------------------

app.patch("/api/bookings/:id/complete", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to manage bookings.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    const studioId = getBookingStudioObjectId(booking);

    if (!studioId) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: studioId,
    });

    if (!studio || !isStudioOwner(studio, user)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to complete this booking.",
      });
    }

    if (studio.isDeleted === true) {
      return studioNotAvailable(res);
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: booking._id,
        status: /^confirmed$/i,
        endTime: { $lte: new Date() },
      },
      {
        $set: {
          status: "Completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).json({
        success: false,
        message:
          "Only confirmed bookings whose end time has passed can be marked completed.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking marked as completed.",
    });
  } catch (error) {
    console.error("Complete booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to complete booking.",
    });
  }
});

// --------------------------------------------------
// CUSTOMER CANCELS OWN PENDING BOOKING
// --------------------------------------------------

app.patch("/api/bookings/:id/cancel", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to cancel a booking.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: new ObjectId(id),
        $or: [{ userId: user.id }, { userEmail: user.email }],
        status: /^pending$/i,
      },
      {
        $set: {
          status: "Cancelled",
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pending booking not found or already updated.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully.",
    });
  } catch (error) {
    console.error("Cancel booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel booking.",
    });
  }
});

// --------------------------------------------------
// CUSTOMER SUBMITS REVIEW
// --------------------------------------------------

app.post("/api/reviews", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to submit a review.",
      });
    }

    const { bookingId, rating, comment } = req.body || {};

    if (!bookingId || !ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const numericRating = Number(rating);

    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5.",
      });
    }

    if (
      typeof comment !== "string" ||
      comment.trim().length < 5 ||
      comment.trim().length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Review must contain 5 to 1000 characters.",
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      $or: [{ userId: user.id }, { userEmail: user.email }],
      status: /^confirmed$/i,
    });

    if (!booking) {
      return res.status(403).json({
        success: false,
        message: "Only your confirmed bookings can be reviewed.",
      });
    }

    const studioId = getBookingStudioObjectId(booking);

    if (!studioId) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    const studio = await studiosCollection.findOne({
      _id: studioId,
    });

    if (!studio) {
      return res.status(404).json({
        success: false,
        message: "Studio not found.",
      });
    }

    const review = {
      bookingId: booking._id,
      studioId,
      userId: user.id,
      userName: user.name || "StudioSpace User",
      rating: numericRating,
      comment: comment.trim(),
      createdAt: new Date(),
    };

    try {
      await reviewsCollection.insertOne(review);
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "You have already reviewed this booking.",
        });
      }

      throw error;
    }

    const [stats] = await reviewsCollection
      .aggregate([
        { $match: { studioId } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            reviewCount: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const averageRating = Number((stats?.averageRating || 0).toFixed(1));

    const reviewCount = stats?.reviewCount || 0;

    await studiosCollection.updateOne(
      { _id: studioId },
      {
        $set: {
          rating: averageRating,
          reviewCount,
          updatedAt: new Date(),
        },
      },
    );

    return res.status(201).json({
      success: true,
      message: "Your review has been submitted successfully!",
      rating: averageRating,
      reviewCount,
    });
  } catch (error) {
    console.error("Submit review error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to submit your review.",
    });
  }
});

// --------------------------------------------------
// CREATE STUDIO
// --------------------------------------------------

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
    } = req.body || {};

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

    if (!isValidHttpUrl(imageUrl)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid HTTP or HTTPS image URL.",
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
      imageUrl: new URL(imageUrl.trim()).toString(),
      amenities: Array.isArray(amenities)
        ? amenities
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim())
        : [],
      overview: overview.trim(),
      ownerId: user.id,
      ownerName: user.name || "",
      ownerEmail: user.email,
      rating: 0,
      reviewCount: 0,
      isDeleted: false,
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

// --------------------------------------------------
// UPDATE STUDIO
// --------------------------------------------------

app.put("/api/studios/:id", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to update a studio.",
      });
    }

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID.",
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
    } = req.body || {};

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

    if (!isValidHttpUrl(imageUrl)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid HTTP or HTTPS image URL.",
      });
    }

    if (overview.trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: "Studio overview must contain at least 30 characters.",
      });
    }

    if (
      !Array.isArray(amenities) ||
      !amenities.every(
        (item) => typeof item === "string" && item.trim().length > 0,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid studio amenities.",
      });
    }

    const updatedData = {
      title: title.trim(),
      category: category.trim(),
      hourlyRate: rate,
      securityDeposit: deposit,
      capacity: maxCapacity,
      location: location.trim(),
      imageUrl: new URL(imageUrl.trim()).toString(),
      amenities: [...new Set(amenities.map((item) => item.trim()))],
      overview: overview.trim(),
      updatedAt: new Date(),
    };

    const result = await studiosCollection.updateOne(
      {
        _id: new ObjectId(id),
        isDeleted: { $ne: true },
        $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
      },
      {
        $set: updatedData,
      },
    );

    if (result.matchedCount === 0) {
      const existingStudio = await studiosCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!existingStudio || existingStudio.isDeleted === true) {
        return res.status(404).json({
          success: false,
          message: "Studio not found or no longer available.",
        });
      }

      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this studio.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Studio updated successfully!",
    });
  } catch (error) {
    console.error("Update studio error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update studio.",
    });
  }
});

// --------------------------------------------------
// SOFT DELETE STUDIO
// --------------------------------------------------

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

    const result = await studiosCollection.updateOne(
      {
        _id: new ObjectId(id),
        $or: [{ ownerId: user.id }, { ownerEmail: user.email }],
        isDeleted: { $ne: true },
      },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Studio not found or you are not the owner.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Studio deleted successfully!",
    });
  } catch (error) {
    console.error("Delete studio error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete studio.",
    });
  }
});

// --------------------------------------------------
// LOCAL SERVER STARTUP
// --------------------------------------------------

// Only start a listening server during local development.
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`StudioSpace server is running at http://localhost:${PORT}`);
  });
}

export default app;
