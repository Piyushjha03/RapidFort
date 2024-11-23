import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import Bull from "bull";
import libre from "libreoffice-convert";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// MongoDB Schema
const fileConversionSchema = new mongoose.Schema({
  fileId: mongoose.Schema.Types.ObjectId,
  fileName: String,
  originalS3Path: String,
  convertedS3Path: String,
  status: {
    type: String,
    enum: ["pending", "completed", "failed"],
    default: "pending",
  },
  conversionDate: { type: Date, default: Date.now },
});

const ConvertedFile = mongoose.model("ConvertedFile", fileConversionSchema);

// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer Memory Storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Redis Queue for File Conversion
const fileConversionQueue = new Bull("file-conversion-queue", {
  redis: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
});

// Queue Processor
fileConversionQueue.process(async (job) => {
  const { fileId, fileKey } = job.data;

  try {
    console.log(`Processing file conversion for fileId: ${fileId}`);

    // Fetch the file from S3
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileKey,
      })
    );

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const inputBuffer = Buffer.concat(chunks);

    // Convert file to PDF using LibreOffice
    const pdfBuffer = await convertAsync(inputBuffer, "pdf");

    // Upload the converted file to S3
    const convertedFileKey = `converted/${Date.now()}_${fileKey
      .split("/")
      .pop()
      .replace(/\.[^/.]+$/, ".pdf")}`;
    const convertedS3Path = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${convertedFileKey}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: convertedFileKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    console.log(`Converted file uploaded to S3 for fileId: ${fileId}`);

    // Update the Conversion Record in MongoDB
    const updatedConversionRecord = await ConvertedFile.findOneAndUpdate(
      { fileId },
      {
        fileId,
        fileName: fileKey.split("/").pop(),
        originalS3Path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`,
        convertedS3Path,
        status: "completed",
      },
      { upsert: true, new: true }
    );

    console.log(
      `File conversion record updated successfully for fileId: ${fileId}`,
      updatedConversionRecord
    );
  } catch (error) {
    console.error(
      `File conversion failed for fileId: ${fileId}`,
      error.message
    );

    // Mark the status as "failed" in case of errors
    await ConvertedFile.findOneAndUpdate(
      { fileId },
      { status: "failed" },
      { upsert: true }
    );
  }
});

// Promisified LibreOffice Conversion
const convertAsync = (inputBuffer, format) =>
  new Promise((resolve, reject) => {
    libre.convert(inputBuffer, format, undefined, (err, done) => {
      if (err) reject(err);
      else resolve(done);
    });
  });

// Routes
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file uploaded." });
    }

    // Upload the original file to S3
    const fileKey = `uploads/${Date.now()}_${file.originalname}`;
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    const s3FilePath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    console.log(`File uploaded to S3: ${s3FilePath}`);

    // Save file record in MongoDB
    const fileRecord = new ConvertedFile({
      fileName: file.originalname,
      originalS3Path: s3FilePath,
      status: "pending",
    });
    await fileRecord.save();

    console.log(`File record created in MongoDB: ${fileRecord._id}`);

    // Add the job to the Bull queue
    await fileConversionQueue.add({
      fileId: fileRecord._id.toString(),
      fileKey,
    });

    res.status(200).json({
      message: "File uploaded successfully and queued for conversion",
      fileId: fileRecord._id,
    });
  } catch (error) {
    console.error("Error during file upload:", error.message);
    res.status(500).json({ message: "Failed to upload file" });
  }
});

app.get("/status/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    const fileRecord = await ConvertedFile.findOne({ fileId });

    if (!fileRecord) {
      return res.status(404).json({ message: "File not found" });
    }

    res.status(200).json({
      fileName: fileRecord.fileName,
      originalS3Path: fileRecord.originalS3Path,
      convertedS3Path: fileRecord.convertedS3Path,
      status: fileRecord.status,
    });
  } catch (error) {
    console.error("Error fetching file status:", error.message);
    res.status(500).json({ message: "Error fetching file status" });
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: "Internal server error" });
});

// Start the Server
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`File Upload and Conversion Service running on port ${PORT}`);
});
