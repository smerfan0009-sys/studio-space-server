# StudioSpace Server

Express 5 API for the StudioSpace creative-studio marketplace. Provides Better
Auth authentication, studio CRUD, bookings, host booking management, reviews,
and ImgBB image uploads backed by MongoDB.

## Stack

- Express 5 + Node.js ES modules
- MongoDB (`mongodb` driver) with collections: `studios`, `bookings`,
  `reviews`, `newsletter`, plus Better Auth collections (`user`, `session`,
  `account`, `verification`, `jwks`)
- Better Auth with the MongoDB adapter and the JWT plugin
- Multer + ImgBB for cover-image uploads
- CORS locked to `CLIENT_URL` with credentials enabled

## Getting Started

```bash
npm install
npm run dev   # nodemon index.js
```

The API listens on `PORT` (default `7000`).

## Environment

Create a `.env` file with (names only):

```txt
PORT
MONGODB_URI
BETTER_AUTH_URL
BETTER_AUTH_SECRET
CLIENT_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
IMGBB_API_KEY
```

## API Overview

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/studios` | — | List available studios |
| GET | `/api/studios/featured` | — | Top 6 studios |
| GET | `/api/studios/:id` | — | Studio details |
| GET | `/api/studios/:id/reviews` | — | Studio reviews |
| GET | `/api/my-listings` | Yes | Studios owned by the session user |
| POST | `/api/studios` | Yes | Create a studio (owner from session) |
| PUT | `/api/studios/:id` | Yes | Update own studio |
| DELETE | `/api/studios/:id` | Yes | Soft-delete own studio |
| POST | `/api/bookings` | Yes | Request a booking (Pending) |
| GET | `/api/my-bookings` | Yes | Session user's bookings |
| PATCH | `/api/bookings/:id/confirm` | Yes | Host confirms a pending booking |
| PATCH | `/api/bookings/:id/reject` | Yes | Host rejects a pending booking |
| PATCH | `/api/bookings/:id/complete` | Yes | Host completes a booking |
| PATCH | `/api/bookings/:id/cancel` | Yes | Customer cancels a pending booking |
| POST | `/api/reviews` | Yes | Review a confirmed booking |
| POST | `/api/newsletter` | — | Newsletter subscription |
| POST | `/api/upload-image` | Yes | Upload a cover image to ImgBB |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start with nodemon |
| `npm start` | Start with plain Node |
