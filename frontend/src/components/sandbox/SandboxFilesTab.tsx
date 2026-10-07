import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ExpandableSection,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  List,
  ListItem,
  MultipleFileUpload,
  MultipleFileUploadMain,
  MultipleFileUploadStatus,
  MultipleFileUploadStatusItem,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import {
  DownloadIcon,
  FolderOpenIcon,
  UploadIcon,
} from '@patternfly/react-icons';

import { downloadFile, uploadFile } from '../../api/sandboxes';
import type { DownloadedFile } from '../../api/sandboxes';
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  uploadRelativePath,
} from '../../utils/fileTransfer';

type SandboxFilesTabProps = {
  workspace: string;
  sandboxName: string;
};

// "failed" is an upload that did not work and can be tried again. "refused"
// is a file that is not sent because sending it cannot work: there is nothing
// to try again.
type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'refused';

type UploadItem = {
  id: number;
  file: File;
  // Where the file goes below the destination directory.
  relativePath: string;
  status: UploadStatus;
  // 0 to 100.
  progress: number;
  // Where the file was written, or why it was not.
  detail?: string;
  // The destination directory the file was uploaded to.
  destination?: string;
};

// The directory a file goes to when the destination is left empty: the BFF's
// own default.
const DEFAULT_DESTINATION = '/sandbox';

// How many files are on their way at a time.
const UPLOAD_CONCURRENCY = 3;
// How many files and failures are listed. A folder can hold thousands.
const LISTED_FILES = 100;
const LISTED_FAILURES = 20;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

// The status list reads a file into memory to show it unless it is given
// something else to do with it.
const leaveUnread = () => undefined;

const SandboxFilesTab: React.FC<SandboxFilesTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const [dest, setDest] = useState(DEFAULT_DESTINATION);
  // The list as it is shown, and the same list for the uploads that are
  // running to read. An upload outlives the render that started it, and has
  // to see a file taken off the list the moment it is taken off: every change
  // goes through setItemList, which writes both.
  const [items, setItems] = useState<UploadItem[]>([]);
  const listed = useRef<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const nextId = useRef(0);
  const stopRequested = useRef(false);
  // Aborts the requests of the upload that is running.
  const running = useRef<AbortController | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const [downloadPath, setDownloadPath] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<DownloadedFile | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // An upload nobody can see any more is stopped: the files on their way are
  // aborted and no other is started. Left running it would go on sending the
  // rest of a folder with nothing on screen to say so, or to stop it.
  useEffect(
    () => () => {
      stopRequested.current = true;
      running.current?.abort();
    },
    [],
  );

  const setItemList = (change: (current: UploadItem[]) => UploadItem[]) => {
    listed.current = change(listed.current);
    setItems(listed.current);
  };

  const setFolderInput = (element: HTMLInputElement | null) => {
    folderInput.current = element;
    // What makes the picker offer folders. React has no prop for it.
    element?.setAttribute('webkitdirectory', '');
  };

  const addFiles = (files: File[]) => {
    const added = files.map((file): UploadItem => {
      nextId.current += 1;
      const item = {
        id: nextId.current,
        file,
        relativePath: uploadRelativePath(file),
        progress: 0,
      };
      // Known before anything is sent, and no later attempt can change it.
      return file.size > MAX_UPLOAD_BYTES
        ? {
            ...item,
            status: 'refused',
            detail: `Larger than the ${formatBytes(MAX_UPLOAD_BYTES)} one file can be`,
          }
        : { ...item, status: 'queued' };
    });
    // A file picked again replaces the one already listed for that path.
    const replaced = new Set(added.map((item) => item.relativePath));
    setItemList((current) => [
      ...current.filter(
        (item) =>
          item.status === 'uploading' || !replaced.has(item.relativePath),
      ),
      ...added,
    ]);
  };

  const updateItem = (id: number, change: Partial<UploadItem>) =>
    setItemList((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );

  // A file that is on its way stays listed until it has arrived or failed.
  const removeItem = (id: number) =>
    setItemList((current) =>
      current.filter((item) => item.id !== id || item.status === 'uploading'),
    );

  const uploadItem = async (
    item: UploadItem,
    destination: string,
    signal: AbortSignal,
  ) => {
    updateItem(item.id, { status: 'uploading', progress: 0, detail: '' });
    try {
      const result = await uploadFile(
        workspace,
        sandboxName,
        item.file,
        destination || undefined,
        {
          // A file on its own is sent the way it always was, by its name.
          relativePath: item.relativePath.includes('/')
            ? item.relativePath
            : undefined,
          onProgress: (sent) =>
            updateItem(item.id, { progress: Math.round(sent * 100) }),
          signal,
        },
      );
      updateItem(item.id, {
        status: 'uploaded',
        progress: 100,
        detail: result.path,
        destination: destination || DEFAULT_DESTINATION,
      });
    } catch (err) {
      // Stopped because the tab went away: there is no list left to mark.
      if (signal.aborted) {
        return;
      }
      updateItem(item.id, {
        status: 'failed',
        detail: (err as Error).message,
      });
    }
  };

  const handleUpload = async () => {
    // The files to send, by id. What each of them is, and whether it is
    // still wanted, is looked up when its turn comes.
    const queue = listed.current
      .filter((item) => item.status === 'queued' || item.status === 'failed')
      .map((item) => item.id);
    if (queue.length === 0) {
      return;
    }
    stopRequested.current = false;
    const controller = new AbortController();
    running.current = controller;
    setIsUploading(true);
    const destination = dest;
    const worker = async () => {
      while (!stopRequested.current) {
        const id = queue.shift();
        if (id === undefined) {
          return;
        }
        // A file that was taken off the list while it waited, or replaced by
        // one picked again, is not sent.
        const item = listed.current.find((candidate) => candidate.id === id);
        if (item) {
          await uploadItem(item, destination, controller.signal);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
        worker,
      ),
    );
    setIsUploading(false);
  };

  const handleDownload = async () => {
    if (!downloadPath) {
      return;
    }
    setDownloadError(null);
    setDownloaded(null);
    setIsDownloading(true);
    try {
      setDownloaded(await downloadFile(workspace, sandboxName, downloadPath));
    } catch (err) {
      setDownloadError((err as Error).message);
    } finally {
      setIsDownloading(false);
    }
  };

  const uploadedItems = items.filter((item) => item.status === 'uploaded');
  const uploaded = uploadedItems.length;
  const refused = items.filter((item) => item.status === 'refused').length;
  // What did not arrive: an upload that failed, or a file that was not sent.
  const failures = items.filter(
    (item) => item.status === 'failed' || item.status === 'refused',
  );
  const waiting = items.filter((item) => item.status === 'queued').length;
  // What the button would send: the files not sent yet, and the failed ones
  // again. A refused file is not among them.
  const toSend = waiting + failures.length - refused;
  // Where the uploaded files went, as the uploads were asked to put them.
  const destinations = [
    ...new Set(uploadedItems.map((item) => item.destination ?? dest)),
  ];

  let summary = `${plural(toSend, 'file')} to upload`;
  if (refused > 0) {
    summary += `, ${refused} cannot be sent`;
  }
  if (isUploading) {
    summary = `Uploading: ${uploaded + failures.length} of ${plural(items.length, 'file')} done`;
  } else if (uploaded + failures.length - refused > 0) {
    summary = `${uploaded} of ${plural(items.length, 'file')} uploaded`;
    if (failures.length > 0) {
      summary += `, ${failures.length} failed`;
    }
  }
  let summaryIcon: 'inProgress' | 'danger' | 'success' | undefined;
  if (isUploading) {
    summaryIcon = 'inProgress';
  } else if (failures.length > 0) {
    summaryIcon = 'danger';
  } else if (items.length > 0 && uploaded === items.length) {
    summaryIcon = 'success';
  }
  let uploadLabel = 'Upload';
  if (toSend > 0) {
    uploadLabel = `${waiting === 0 ? 'Retry' : 'Upload'} ${plural(toSend, 'file')}`;
  }

  return (
    <Stack hasGutter>
      <StackItem>
        <Content component="p" data-testid="files-intro">
          Move files between your computer and this sandbox. There is no file
          browser here: to download something you need to know its path.
        </Content>
        <ExpandableSection
          toggleText="What the Files tab does differently from the openshell CLI"
          data-testid="files-limits"
        >
          <List>
            <ListItem>
              Uploads are not filtered. <code>openshell sandbox upload</code>{' '}
              leaves out what <code>.gitignore</code> ignores in a Git checkout;
              here every file in a folder you pick is sent.
            </ListItem>
            <ListItem>
              Only the contents of files are sent. Permissions, timestamps and
              empty folders are not kept, a symbolic link is not kept as a link,
              and a file cannot be renamed on the way.
            </ListItem>
            <ListItem>
              Each file is sent on its own and can be up to{' '}
              {formatBytes(MAX_UPLOAD_BYTES)}. A file whose upload fails part
              way can be left incomplete in the sandbox.
            </ListItem>
            <ListItem>
              An upload goes on while you look at another tab of this sandbox,
              and stops when you leave the sandbox&apos;s page: the files on
              their way are cut off and the rest are not sent.
            </ListItem>
            <ListItem>
              A directory downloads as one <code>.tar</code> archive of its
              contents, with symbolic links kept as links. It is not unpacked
              for you: extract it into a folder of its own.
            </ListItem>
            <ListItem>
              A download is held in the browser&apos;s memory until it is saved.
              For very large files and directories, use{' '}
              <code>openshell sandbox download</code>.
            </ListItem>
            <ListItem>
              Paths are absolute, and any path the sandbox user can read can be
              downloaded. The CLI also takes paths relative to the
              sandbox&apos;s working directory and downloads only from inside
              it.
            </ListItem>
          </List>
        </ExpandableSection>
      </StackItem>
      <StackItem>
        <Card data-testid="file-upload-card">
          <CardTitle>Upload files and folders</CardTitle>
          <CardBody>
            <Form>
              <FormGroup label="Destination directory" fieldId="dest-input">
                <TextInput
                  id="dest-input"
                  data-testid="file-upload-dest"
                  value={dest}
                  onChange={(_event, value) => setDest(value)}
                  placeholder="/sandbox"
                  isDisabled={isUploading}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      An absolute path in the sandbox, created if it does not
                      exist. A folder is written below it with its structure,
                      and a file that is already there is replaced.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <MultipleFileUpload
                onFileDrop={(_event, files) => addFiles(files)}
                data-testid="file-upload-dropzone"
              >
                <MultipleFileUploadMain
                  titleIcon={<UploadIcon />}
                  titleText="Drag and drop files or folders here"
                  titleTextSeparator="or"
                  browseButtonText="Select files"
                  infoText={`Up to ${formatBytes(MAX_UPLOAD_BYTES)} per file.`}
                />
                {items.length > 0 && (
                  <MultipleFileUploadStatus
                    statusToggleText={summary}
                    statusToggleIcon={summaryIcon}
                    aria-label="Files to upload"
                    data-testid="file-upload-status"
                  >
                    {items.slice(0, LISTED_FILES).map((item) => (
                      <MultipleFileUploadStatusItem
                        key={item.id}
                        file={item.file}
                        fileName={item.relativePath}
                        customFileHandler={leaveUnread}
                        progressValue={item.progress}
                        progressVariant={
                          (item.status === 'uploaded' && 'success') ||
                          ((item.status === 'failed' ||
                            item.status === 'refused') &&
                            'danger') ||
                          undefined
                        }
                        progressAriaLabel={`Upload of ${item.relativePath}`}
                        progressHelperText={
                          item.detail && (
                            <HelperText isLiveRegion>
                              <HelperTextItem
                                variant={
                                  item.status === 'failed' ||
                                  item.status === 'refused'
                                    ? 'error'
                                    : 'default'
                                }
                              >
                                {item.detail}
                              </HelperTextItem>
                            </HelperText>
                          )
                        }
                        buttonAriaLabel={`Remove ${item.relativePath} from the list`}
                        onClearClick={() => removeItem(item.id)}
                        data-testid="file-upload-item"
                      />
                    ))}
                  </MultipleFileUploadStatus>
                )}
              </MultipleFileUpload>
              {items.length > LISTED_FILES && (
                <HelperText>
                  <HelperTextItem data-testid="file-upload-unlisted">
                    The first {LISTED_FILES} of {items.length} files are listed.
                    All of them are uploaded.
                  </HelperTextItem>
                </HelperText>
              )}
              <input
                type="file"
                multiple
                hidden
                ref={setFolderInput}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  // So that picking the same folder again is a change.
                  event.target.value = '';
                }}
                data-testid="file-upload-folder-input"
              />
              <Flex>
                <FlexItem>
                  <Button
                    variant="secondary"
                    icon={<FolderOpenIcon />}
                    onClick={() => folderInput.current?.click()}
                    isDisabled={isUploading}
                    data-testid="file-upload-folder-button"
                  >
                    Select folder
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    icon={<UploadIcon />}
                    onClick={handleUpload}
                    isLoading={isUploading}
                    isDisabled={isUploading || toSend === 0}
                    data-testid="file-upload-button"
                  >
                    {uploadLabel}
                  </Button>
                </FlexItem>
                {isUploading ? (
                  <FlexItem>
                    <Button
                      variant="link"
                      onClick={() => {
                        stopRequested.current = true;
                      }}
                      data-testid="file-upload-stop"
                    >
                      Stop after the files being sent
                    </Button>
                  </FlexItem>
                ) : (
                  items.length > 0 && (
                    <FlexItem>
                      <Button
                        variant="link"
                        onClick={() => setItemList(() => [])}
                        data-testid="file-upload-clear"
                      >
                        Clear list
                      </Button>
                    </FlexItem>
                  )
                )}
              </Flex>
            </Form>
            {!isUploading && failures.length > 0 && (
              <Alert
                variant="danger"
                isInline
                title={`${plural(failures.length, 'file')} could not be uploaded`}
                className="pf-v6-u-mt-md"
                data-testid="file-upload-error"
              >
                <List>
                  {failures.slice(0, LISTED_FAILURES).map((item) => (
                    <ListItem key={item.id}>
                      {item.relativePath}: {item.detail}
                    </ListItem>
                  ))}
                  {failures.length > LISTED_FAILURES && (
                    <ListItem>
                      and {failures.length - LISTED_FAILURES} more
                    </ListItem>
                  )}
                </List>
              </Alert>
            )}
            {!isUploading && items.length > 0 && uploaded === items.length && (
              <Alert
                variant="success"
                isInline
                title={`Uploaded ${plural(uploaded, 'file')} to ${destinations.join(' and ')}`}
                className="pf-v6-u-mt-md"
                data-testid="file-upload-result"
              />
            )}
          </CardBody>
        </Card>
      </StackItem>
      <StackItem>
        <Card data-testid="file-download-card">
          <CardTitle>Download a file or a directory</CardTitle>
          <CardBody>
            <Form>
              <FormGroup label="Path" isRequired fieldId="download-path">
                <TextInput
                  id="download-path"
                  data-testid="file-download-path"
                  value={downloadPath}
                  onChange={(_event, value) => setDownloadPath(value)}
                  placeholder="/sandbox/file.txt"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      An absolute path in the sandbox. A file downloads as it
                      is, and a directory as a .tar archive of its contents.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
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
            {downloaded && (
              <Alert
                variant="success"
                isInline
                title={`Downloaded ${downloaded.fileName} (${formatBytes(downloaded.size)})`}
                className="pf-v6-u-mt-md"
                data-testid="file-download-result"
              >
                {downloaded.isArchive &&
                  'The path is a directory, so this is a tar archive of its contents. The contents are at the top level of the archive: extract it into a folder of its own.'}
              </Alert>
            )}
          </CardBody>
        </Card>
      </StackItem>
    </Stack>
  );
};

export default SandboxFilesTab;
