import { useState } from "react";
import "./App.css";
import FileUpload from "./components/custom/fileupload";
import FileMetadata from "./components/custom/filemetadata";
import FileDownload from "./components/custom/filedownload";

function App() {
  const [fileId, setFileId] = useState(null);
  const [metadata, setMetadata] = useState(null);

  const handleUploadSuccess = (uploadedFileId) => {
    setFileId(uploadedFileId);
  };

  const handleMetadataFetch = (fetchedMetadata) => {
    setMetadata(fetchedMetadata);
  };

  return (
    <div className="App">
      <h1 className="text-2xl font-bold mb-4">File Processing Application</h1>
      <FileUpload onSuccess={handleUploadSuccess} />
      {fileId && (
        <FileMetadata fileId={fileId} onMetadataFetch={handleMetadataFetch} />
      )}
      {metadata && <FileDownload fileId={fileId} />}
    </div>
  );
}

export default App;
