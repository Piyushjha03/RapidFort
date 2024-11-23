import express from "express";
import mongoose from "mongoose";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { S3RequestPresigner } from "@aws-sdk/s3-request-presigner";

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

// MongoDB Schema (shared with conversion service)
const fileConversionSchema = new mongoose.Schema({
  fileId: mongoose.Schema.Types.ObjectId, // Reference to the original file
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

// Route to Download File by ID
app.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    // Fetch file metadata from MongoDB
    const fileRecord = await ConvertedFile.findOne({ fileId });
    if (!fileRecord) {
      return res.status(404).json({ message: "File not found" });
    }

    // Decide whether to download the converted or original file
    const filePath = fileRecord.convertedS3Path || fileRecord.originalS3Path;
    const fileName = fileRecord.fileName;

    if (!filePath) {
      console.error("Invalid filePath. Cannot stream file.");
      return res.status(400).json({ message: "No valid file path found" });
    }

    // Extract the S3 Key from the path
    const urlParts = filePath.match(
      /https:\/\/(.*)\.s3\.(.*)\.amazonaws\.com\/(.*)/
    );
    const key = urlParts ? urlParts[3] : null;

    if (!key) {
      console.error("Unable to extract S3 key from filePath:", filePath);
      return res.status(500).json({ message: "Invalid S3 URL format" });
    }

    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      console.error("S3_BUCKET_NAME is not configured in the environment.");
      return res.status(500).json({ message: "S3 bucket name not configured" });
    }

    // Fetch the file from S3 and pipe it to the client
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });

    const s3Response = await s3Client.send(command);

    // Set headers for file download
    res.setHeader(
      "Content-Type",
      s3Response.ContentType || "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName || key.split("/").pop()}"`
    );

    console.log("Streaming file to client...");
    s3Response.Body.pipe(res); // Pipe S3 file content directly to the response
  } catch (error) {
    console.error("Error streaming file:", error.message);
    res.status(500).send("Failed to download file");
  }
});

// Generate Signed URL for S3
const getSignedUrl = async (bucketName, key) => {
  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const presigner = new S3RequestPresigner({ client: s3Client });
    const signedUrl = await presigner.presign(command, { expiresIn: 3600 }); // 1 hour expiry
    return signedUrl;
  } catch (error) {
    throw new Error(`Error creating signed URL: ${error.message}`);
  }
};

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).send("Internal server error");
});

// Start Server
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`File Download Service running on port ${PORT}`);
});
