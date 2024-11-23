import express from "express";
import Bull from "bull";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import getDocumentProperties from "office-document-properties";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const metadataSchema = new mongoose.Schema({
  fileId: mongoose.Schema.Types.ObjectId,
  metadata: Object,
});
const Metadata = mongoose.model("Metadata", metadataSchema);

const fileQueue = new Bull("file-queue", {
  redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Process Bull Queue
fileQueue.process(async (job) => {
  const { fileId, s3FilePath, filekey } = job.data;

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filekey,
      })
    );

    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    const fileBuffer = Buffer.concat(chunks);

    // Extract metadata
    getDocumentProperties.fromBuffer(fileBuffer, async (err, metadata) => {
      if (err) throw new Error("Metadata extraction failed");

      const metadataRecord = new Metadata({ fileId, metadata });
      await metadataRecord.save();
    });
  } catch (error) {
    console.error("Error processing metadata:", error.message);
  }
});

app.get("/metadata/:fileId", async (req, res) => {
  const { fileId } = req.params;

  try {
    const metadataRecord = await Metadata.findOne({ fileId }).select(
      "-_id -__v -fileId"
    );

    if (!metadataRecord) {
      return res.status(404).json({ message: "Metadata not found" });
    }

    res.json(metadataRecord);
  } catch (error) {
    console.error("Error fetching metadata:", error.message);
    res.status(500).json({ message: "Failed to fetch metadata" });
  }
});

app.listen(3002, () => console.log("Metadata Service running on port 3002"));
