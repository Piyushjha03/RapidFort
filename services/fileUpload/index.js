import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Bull from "bull";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// MongoDB Schema
const fileSchema = new mongoose.Schema({
  fileName: String,
  fileType: String,
  fileSize: Number,
  s3FilePath: String,
  uploadDate: { type: Date, default: Date.now },
});
const File = mongoose.model("File", fileSchema);

// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer S3 Setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

const fileQueue = new Bull("file-queue", {
  redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
});

const fileConversionQueue = new Bull("file-conversion-queue", {
  redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
});

// Routes
app.get("/", (req, res) => {
  res.send("File Upload Service");
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).send("No file uploaded.");
    }

    const fileKey = `uploads/${Date.now()}_${file.originalname}`;
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    // Upload to S3
    await s3Client.send(new PutObjectCommand(uploadParams));

    const s3FilePath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    const fileRecord = new File({
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      s3FilePath,
    });
    await fileRecord.save();

    await fileQueue.add({
      fileId: fileRecord._id,
      s3FilePath,
      filekey: fileKey,
    });
    await fileConversionQueue.add({
      fileId: fileRecord._id,
      s3FilePath,
      fileKey: fileKey,
    });

    res
      .status(200)
      .json({ message: "File uploaded successfully", fileId: fileRecord._id });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).send("Failed to upload file");
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).send(err.message);
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`File Upload Service running on port ${PORT}`)
);
