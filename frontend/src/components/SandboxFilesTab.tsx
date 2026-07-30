import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  FileUpload,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import { DownloadIcon, UploadIcon } from '@patternfly/react-icons';

import { downloadFile, useUploadFile } from '../api/sandboxes';
import type { UploadResult } from '../api/sandboxes';

type SandboxFilesTabProps = {
  workspace: string;
  sandboxName: string;
};

const SandboxFilesTab: React.FC<SandboxFilesTabProps> = ({ workspace, sandboxName }) => {
  const upload = useUploadFile(workspace, sandboxName);

  const [dest, setDest] = useState('/sandbox');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const [downloadPath, setDownloadPath] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleUpload = () => {
    if (!selectedFile) {
      return;
    }
    setUploadResult(null);
    upload.mutate(
      { file: selectedFile, dest: dest || undefined },
      {
        onSuccess: (result) => {
          setUploadResult(result);
          setSelectedFile(null);
          setFilename('');
        },
      },
    );
  };

  const handleDownload = async () => {
    if (!downloadPath) {
      return;
    }
    setDownloadError(null);
    setIsDownloading(true);
    try {
      await downloadFile(workspace, sandboxName, downloadPath);
    } catch (err) {
      setDownloadError((err as Error).message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Card data-testid="file-upload-card">
          <CardTitle>Upload file</CardTitle>
          <CardBody>
            <Form>
              <FormGroup label="File" isRequired fieldId="file-input">
                <FileUpload
                  id="file-input"
                  data-testid="file-upload-input"
                  type="text"
                  value={selectedFile ?? undefined}
                  filename={filename}
                  onFileInputChange={(_event, file) => {
                    setSelectedFile(file);
                    setFilename(file.name);
                  }}
                  onClearClick={() => {
                    setSelectedFile(null);
                    setFilename('');
                  }}
                  browseButtonText="Browse"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>Drag and drop a file or click Browse</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup label="Destination directory" fieldId="dest-input">
                <TextInput
                  id="dest-input"
                  data-testid="file-upload-dest"
                  value={dest}
                  onChange={(_event, value) => setDest(value)}
                  placeholder="/sandbox"
                />
              </FormGroup>
              <Button
                icon={<UploadIcon />}
                onClick={handleUpload}
                isLoading={upload.isPending}
                isDisabled={upload.isPending || !selectedFile}
                data-testid="file-upload-button"
              >
                Upload
              </Button>
            </Form>
            {upload.isError && (
              <Alert
                variant="danger"
                isInline
                title="Upload failed"
                className="pf-v6-u-mt-md"
                data-testid="file-upload-error"
              >
                {(upload.error as Error).message}
              </Alert>
            )}
            {uploadResult && (
              <Alert
                variant={uploadResult.exitCode === 0 ? 'success' : 'warning'}
                isInline
                title={
                  uploadResult.exitCode === 0
                    ? `Uploaded to ${uploadResult.path} (${uploadResult.size} bytes)`
                    : `Upload exited with code ${uploadResult.exitCode}`
                }
                className="pf-v6-u-mt-md"
                data-testid="file-upload-result"
              >
                {uploadResult.stderr && <pre>{uploadResult.stderr}</pre>}
              </Alert>
            )}
          </CardBody>
        </Card>
      </StackItem>
      <StackItem>
        <Card data-testid="file-download-card">
          <CardTitle>Download file</CardTitle>
          <CardBody>
            <Form>
              <FormGroup label="File path" isRequired fieldId="download-path">
                <TextInput
                  id="download-path"
                  data-testid="file-download-path"
                  value={downloadPath}
                  onChange={(_event, value) => setDownloadPath(value)}
                  placeholder="/sandbox/file.txt"
                />
              </FormGroup>
              <Button
                icon={<DownloadIcon />}
                onClick={handleDownload}
                isLoading={isDownloading}
                isDisabled={isDownloading || !downloadPath}
                data-testid="file-download-button"
              >
                Download
              </Button>
            </Form>
            {downloadError && (
              <Alert
                variant="danger"
                isInline
                title="Download failed"
                className="pf-v6-u-mt-md"
                data-testid="file-download-error"
              >
                {downloadError}
              </Alert>
            )}
          </CardBody>
        </Card>
      </StackItem>
    </Stack>
  );
};

export default SandboxFilesTab;
