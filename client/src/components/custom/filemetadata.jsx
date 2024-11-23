import { useEffect, useState } from "react";

function FileMetadata({ fileId, onMetadataFetch }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true); // Track metadata fetch status
  const [retries, setRetries] = useState(0);
  const MAX_RETRIES = 10; // Maximum retries for fetching metadata

  useEffect(() => {
    let intervalId;

    const fetchMetadata = async () => {
      try {
        const response = await fetch(
          `http://localhost:8080/file-metadata/metadata/${fileId}`
        );
        const data = await response.json();

        if (response.ok && data.metadata) {
          setMetadata(data.metadata);
          onMetadataFetch(data.metadata);
          clearInterval(intervalId); // Stop polling on success
        } else {
          console.warn("Metadata not available yet.");
          setRetries((prevRetries) => prevRetries + 1);
        }
      } catch (error) {
        console.error("Error fetching metadata:", error.message);
        setRetries((prevRetries) => prevRetries + 1);
      }

      if (retries >= MAX_RETRIES) {
        clearInterval(intervalId); // Stop polling after max retries
        setLoading(false); // Mark fetching process as complete
      }
    };

    // Start polling
    intervalId = setInterval(() => {
      if (retries < MAX_RETRIES) {
        fetchMetadata();
      } else {
        clearInterval(intervalId);
        setLoading(false); // Stop loading after max retries
      }
    }, 2000);

    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, [fileId, onMetadataFetch, retries]);

  return (
    <div className="mt-4">
      <h2 className="text-xl font-semibold mb-2">File Metadata</h2>

      {loading && !metadata && <p>Loading metadata...</p>}
      {!loading && !metadata && (
        <p className="text-sm text-gray-600">No metadata available.</p>
      )}
      {metadata && (
        <pre className="bg-gray-100 p-4 rounded">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      )}

      {/* Show Download Button Regardless of Metadata Status */}
      <button
        onClick={() => handleDownload(fileId)}
        className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        Download File
      </button>
    </div>
  );
}

const handleDownload = async (fileId) => {
  try {
    const response = await fetch(
      `http://localhost:8080/file-download/download/${fileId}`
    );

    if (!response.ok) {
      throw new Error("Failed to download file");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `file_${fileId}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
  } catch (error) {
    console.error("Error downloading file:", error.message);
    alert("Error downloading file. Please try again.");
  }
};

export default FileMetadata;
