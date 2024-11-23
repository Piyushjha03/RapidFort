import React, { useEffect, useState } from "react";

function FileDownload({ fileId }) {
  const [downloadReady, setDownloadReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const intervalId = setInterval(() => {
      checkConversionStatus();
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [fileId]);

  const checkConversionStatus = async () => {
    try {
      const response = await fetch(
        `http://localhost:8080/file-conversion/status/${fileId}`
      );
      const data = await response.json();

      if (response.ok && data.status === "completed") {
        setDownloadReady(true);
        clearInterval(); // Stop polling once the file is ready
      } else if (data.status === "failed") {
        console.error("File conversion failed");
        setError("File conversion failed.");
        clearInterval(); // Stop polling on failure
      }
    } catch (error) {
      console.error("Error checking conversion status:", error.message);
      setError("Error checking file status.");
      clearInterval(); // Stop polling on error
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(
        `http://localhost:8080/file-download/download/${fileId}`
      );
      if (!response.ok) throw new Error("Failed to download file");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `converted_${fileId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (error) {
      console.error("Error downloading file:", error.message);
      alert("Error downloading file: " + error.message);
    }
  };

  return (
    <div className="mt-4">
      {error && <p className="text-red-500 mb-2">{error}</p>}
      <button
        onClick={handleDownload}
        disabled={!downloadReady}
        className={`px-4 py-2 rounded ${
          downloadReady
            ? "bg-blue-500 text-white hover:bg-blue-600"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        {downloadReady ? "Download Converted PDF" : "Preparing file..."}
      </button>
    </div>
  );
}

export default FileDownload;
