import { useState } from 'react';
import {
  Alert,
  Button,
  Content,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MultipleFileUpload,
  MultipleFileUploadMain,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { TimesIcon, UploadIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import {
  PLATFORM_PROFILE_SCOPE,
  useImportProviderProfiles,
  useLintProviderProfiles,
  useUpdateProviderProfile,
} from '../../api/providers';
import type {
  ImportProfileRequest,
  ProfileDiagnostic,
  ProviderProfile,
} from '../../types';
import { parseProfileFile, profileFileFormat } from '../../utils/profileFile';
import ProfileDiagnostics, { isProfileError } from './ProfileDiagnostics';

type ProfileFileModalProps = {
  // The workspace the profiles go into, or PLATFORM_PROFILE_SCOPE.
  scope: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  // The profile to update from a file. Without one, files are imported as
  // new profiles.
  target?: ProviderProfile;
};

// A file that was chosen, and what reading it gave: a profile, or the reason
// it is not one.
type ReadFile = {
  name: string;
  profile?: ImportProfileRequest;
  diagnostics: ProfileDiagnostic[];
};

const notAProfile = (name: string, message: string): ReadFile => ({
  name,
  diagnostics: [{ source: name, field: 'file', message, severity: 'error' }],
});

// The text of a chosen file.
const textOf = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });

const readFile = async (file: File): Promise<ReadFile> => {
  const format = profileFileFormat(file.name);
  if (!format) {
    return notAProfile(
      file.name,
      'unsupported provider profile file format: a profile file is .yaml, .yml or .json',
    );
  }
  try {
    return {
      name: file.name,
      ...parseProfileFile(await textOf(file), format, file.name),
    };
  } catch (error) {
    return notAProfile(
      file.name,
      `failed to read provider profile file: ${(error as Error).message}`,
    );
  }
};

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

// Imports provider profiles from profile files, or updates one profile from a
// file: `openshell provider profile import --file` and `update --file`.
//
// Nothing is written until the files have been read and, for an import,
// checked by the gateway, and what was found is on screen. A file that is not
// a profile, or a profile the gateway has an error for, stops the whole
// import, as it does in the CLI; the gateway imports all of a set or none.
const ProfileFileModal: React.FC<ProfileFileModalProps> = ({
  scope,
  isOpen,
  onClose,
  onSuccess,
  target,
}) => {
  const [files, setFiles] = useState<ReadFile[]>([]);
  const lint = useLintProviderProfiles(scope);
  const importProfiles = useImportProviderProfiles(scope);
  const updateProfile = useUpdateProviderProfile(scope);
  const isUpdate = target !== undefined;
  const write = isUpdate ? updateProfile : importProfiles;

  const profiles = files.flatMap((file) =>
    file.profile ? [file.profile] : [],
  );

  const close = () => {
    setFiles([]);
    lint.reset();
    importProfiles.reset();
    updateProfile.reset();
    onClose();
  };

  // Replaces the chosen files and has the gateway check the profiles in them.
  // An update is not checked this way: to the gateway's lint a profile that
  // already exists is an error, and the update checks the profile itself
  // before it writes anything.
  const choose = (next: ReadFile[]) => {
    setFiles(next);
    importProfiles.reset();
    updateProfile.reset();
    lint.reset();
    const readable = next.flatMap((file) =>
      file.profile ? [file.profile] : [],
    );
    if (!isUpdate && readable.length > 0) {
      lint.mutate(readable);
    }
  };

  const add = async (added: File[]) => {
    const read = await Promise.all(added.map(readFile));
    if (isUpdate) {
      // One profile is updated from one file.
      choose(read.slice(-1));
      return;
    }
    // A file chosen again replaces the earlier reading of it.
    const names = new Set(read.map((file) => file.name));
    choose([...files.filter((file) => !names.has(file.name)), ...read]);
  };

  // What the dashboard found reading the files, then what the gateway found:
  // checking them, or refusing to write them.
  //
  // A file that updates a profile has to be that profile's: the same id, and,
  // when the file says which scope it was exported from, the same scope. One
  // id can be a workspace profile and the platform profile it shadows; both
  // are listed, both export to a file of that id, and after a first import
  // both are at the same resource version, so the gateway's check of the
  // version would let the one overwrite the other. A file that names no scope
  // (written by hand) is taken on its id.
  const candidate = isUpdate && profiles.length === 1 ? profiles[0] : undefined;
  const targetMismatch: ProfileDiagnostic[] = [];
  if (isUpdate && candidate && candidate.id !== target.id) {
    targetMismatch.push({
      source: files[0]?.name,
      profileId: candidate.id,
      field: 'id',
      message: `this file is profile "${candidate.id}", not "${target.id}"`,
      severity: 'error',
    });
  }
  if (
    isUpdate &&
    candidate?.scope &&
    target.scope &&
    candidate.scope !== target.scope
  ) {
    targetMismatch.push({
      source: files[0]?.name,
      profileId: candidate.id,
      field: 'scope',
      message: `this file is the ${candidate.scope} profile "${candidate.id}", and the profile being updated is the ${target.scope} one`,
      severity: 'error',
    });
  }
  const written = isUpdate ? updateProfile.data : importProfiles.data;
  const diagnostics = [
    ...files.flatMap((file) => file.diagnostics),
    ...targetMismatch,
    ...(written?.diagnostics ?? lint.data?.diagnostics ?? []),
  ];
  const hasErrors = diagnostics.some(isProfileError);
  const refused =
    written !== undefined &&
    !(isUpdate ? updateProfile.data?.updated : importProfiles.data?.imported);

  const canWrite =
    profiles.length > 0 &&
    !hasErrors &&
    !write.isPending &&
    (isUpdate || lint.isSuccess);

  const submit = () => {
    if (!canWrite) {
      return;
    }
    if (isUpdate) {
      const profile = profiles[0];
      updateProfile.mutate(
        {
          profileId: target.id,
          profile,
          // The version the file was exported at, as the CLI sends it: the
          // gateway refuses a file that is older than the stored profile.
          expectedResourceVersion: profile.resourceVersion,
        },
        {
          onSuccess: (result) => {
            if (result.updated) {
              onSuccess?.(`Profile "${target.id}" updated`);
              close();
            }
          },
        },
      );
      return;
    }
    importProfiles.mutate(profiles, {
      onSuccess: (result) => {
        if (result.imported) {
          onSuccess?.(`Imported ${plural(result.profiles.length, 'profile')}`);
          close();
        }
      },
    });
  };

  const title = isUpdate
    ? `Update profile ${target.id} from a file`
    : 'Import provider profiles';
  const destination =
    scope === PLATFORM_PROFILE_SCOPE
      ? 'the platform scope, where every workspace sees them'
      : `workspace ${scope}`;

  return (
    <Modal variant="large" isOpen={isOpen} onClose={close} aria-label={title}>
      <ModalHeader title={title} />
      <ModalBody>
        <Stack hasGutter>
          <StackItem>
            <Content component="p">
              {isUpdate
                ? 'Choose the profile file to replace this profile with. Export the profile first and edit that file: the update replaces the whole profile, and the file has to carry the resource version it was exported at.'
                : `Choose one or more profile files to import into ${destination}. The gateway checks them first, and nothing is imported unless all of them pass.`}
            </Content>
          </StackItem>
          <StackItem>
            <MultipleFileUpload
              onFileDrop={(_event, dropped) => {
                void add(dropped);
              }}
              dropzoneProps={{ multiple: !isUpdate }}
              data-testid="profile-file-upload"
            >
              <MultipleFileUploadMain
                titleIcon={<UploadIcon />}
                titleText={
                  isUpdate
                    ? 'Drag and drop a profile file here'
                    : 'Drag and drop profile files here'
                }
                titleTextSeparator="or"
                infoText="Accepted file types: YAML (.yaml, .yml), JSON (.json)"
              />
            </MultipleFileUpload>
          </StackItem>
          {files.length > 0 && (
            <StackItem>
              <Table
                aria-label="Chosen profile files"
                variant="compact"
                data-testid="profile-files"
              >
                <Thead>
                  <Tr>
                    <Th>File</Th>
                    <Th>Profile</Th>
                    <Th>Read</Th>
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {files.map((file) => (
                    <Tr key={file.name}>
                      <Td dataLabel="File">{file.name}</Td>
                      <Td dataLabel="Profile">
                        {file.profile
                          ? `${file.profile.displayName} (${file.profile.id})`
                          : '-'}
                      </Td>
                      <Td dataLabel="Read">
                        <Label
                          isCompact
                          status={file.profile ? 'success' : 'danger'}
                        >
                          {file.profile ? 'Profile' : 'Not a profile'}
                        </Label>
                      </Td>
                      <Td isActionCell>
                        <Button
                          variant="plain"
                          aria-label={`Remove ${file.name}`}
                          icon={<TimesIcon />}
                          onClick={() =>
                            choose(files.filter((other) => other !== file))
                          }
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </StackItem>
          )}
          {lint.isPending && (
            <StackItem>
              <Alert
                variant="info"
                isInline
                isPlain
                title="Checking the profiles with the gateway"
              />
            </StackItem>
          )}
          {lint.isError && (
            <StackItem>
              <Alert
                variant="danger"
                isInline
                title="The gateway could not check the profiles"
              >
                {(lint.error as Error).message}
              </Alert>
            </StackItem>
          )}
          {write.isError && (
            <StackItem>
              <Alert
                variant="danger"
                isInline
                title={isUpdate ? 'Update failed' : 'Import failed'}
              >
                {(write.error as Error).message}
              </Alert>
            </StackItem>
          )}
          {refused && (
            <StackItem>
              <Alert
                variant="danger"
                isInline
                title={
                  isUpdate
                    ? 'The gateway did not update the profile'
                    : 'The gateway did not import the profiles'
                }
              >
                Nothing was written. The diagnostics say why.
              </Alert>
            </StackItem>
          )}
          {!refused && lint.isSuccess && !hasErrors && (
            <StackItem>
              <Alert
                variant="success"
                isInline
                isPlain
                title={`The gateway accepts ${plural(profiles.length, 'profile')}`}
              />
            </StackItem>
          )}
          {diagnostics.length > 0 && (
            <StackItem>
              <ProfileDiagnostics diagnostics={diagnostics} />
            </StackItem>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!canWrite}
          isLoading={write.isPending}
          data-testid="profile-file-submit"
        >
          {isUpdate
            ? 'Update profile'
            : `Import ${plural(profiles.length, 'profile')}`}
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ProfileFileModal;
