//go:build compat

package compat

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"testing"
)

// sentFile is one file of an upload, with the path it is to have below the
// destination directory.
type sentFile struct {
	relativePath string
	content      []byte
}

// uploadFiles posts files to a sandbox in one request the way the Files tab
// sends a file out of a folder: a "relativePath" field ahead of each "file"
// part.
func uploadFiles(workspace, sandboxName, destDir string, files ...sentFile) (int, []byte, error) {
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	for _, f := range files {
		if err := form.WriteField("relativePath", f.relativePath); err != nil {
			return 0, nil, err
		}
		// The name of the part is not where the file goes: the field is.
		part, err := form.CreateFormFile("file", "upload.bin")
		if err != nil {
			return 0, nil, err
		}
		if _, err = part.Write(f.content); err != nil {
			return 0, nil, err
		}
	}
	if err := form.Close(); err != nil {
		return 0, nil, err
	}
	path := sandboxPath(workspace, sandboxName) + "/files?dest=" + url.QueryEscape(destDir)
	status, _, raw, err := doRequest(http.MethodPost, path, form.FormDataContentType(), &buf)
	return status, raw, err
}

// uploadedFiles mirrors what the upload endpoint answers with, for a success
// and for a failure: both carry the outcome of each file.
type uploadedFiles struct {
	Code  string `json:"code"`
	Files []struct {
		Path    string `json:"path"`
		Error   string `json:"error"`
		Size    int    `json:"size"`
		Success bool   `json:"success"`
	} `json:"files"`
}

// mustUploadFiles uploads files in one request and fails the test unless
// every one of them is reported written, where it should be.
func mustUploadFiles(t *testing.T, workspace, sandboxName, destDir string, files ...sentFile) {
	t.Helper()
	status, raw, err := uploadFiles(workspace, sandboxName, destDir, files...)
	if err != nil {
		t.Fatalf("upload %d files to %s: %v", len(files), destDir, err)
	}
	if status != http.StatusOK {
		t.Fatalf("upload %d files to %s [gateway %s]: status = %d, want 200; body: %s",
			len(files), destDir, gatewayVersion, status, truncate(raw))
	}
	var res uploadedFiles
	mustDecode(t, raw, &res)
	if len(res.Files) != len(files) {
		t.Fatalf("upload reports %d files, want %d; body: %s", len(res.Files), len(files), truncate(raw))
	}
	for i, f := range files {
		got := res.Files[i]
		if want := destDir + "/" + f.relativePath; got.Path != want || !got.Success || got.Size != len(f.content) {
			t.Errorf("file %d = %+v, want %s written with %d bytes", i, got, want, len(f.content))
		}
	}
}

// archive is what a downloaded tar holds.
type archive struct {
	files map[string][]byte
	// links maps a symbolic link to its target.
	links map[string]string
	dirs  []string
}

// readArchive reads a tar to its end. An archive that was cut short does not
// read to its end.
func readArchive(t *testing.T, raw []byte) archive {
	t.Helper()
	a := archive{files: map[string][]byte{}, links: map[string]string{}}
	reader := tar.NewReader(bytes.NewReader(raw))
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("read the downloaded archive (%d bytes): %v", len(raw), err)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			a.dirs = append(a.dirs, header.Name)
		case tar.TypeSymlink:
			a.links[header.Name] = header.Linkname
		case tar.TypeReg:
			content, readErr := io.ReadAll(reader)
			if readErr != nil {
				t.Fatalf("read %s out of the archive: %v", header.Name, readErr)
			}
			a.files[header.Name] = content
		default:
			t.Errorf("archive entry %s has type %q, want a file, a directory or a link", header.Name, header.Typeflag)
		}
	}
	sort.Strings(a.dirs)
	return a
}

// mustDownloadArchive downloads a directory and fails the test unless it
// arrives as a tar under the given name.
func mustDownloadArchive(t *testing.T, workspace, sandboxName, dirPath, wantName string) archive {
	t.Helper()
	raw, header := mustDownload(t, workspace, sandboxName, dirPath)
	if ct := header.Get("Content-Type"); ct != "application/x-tar" {
		t.Errorf("download of the directory %s: Content-Type = %q, want application/x-tar", dirPath, ct)
	}
	if cd := header.Get("Content-Disposition"); !strings.Contains(cd, `"`+wantName+`"`) {
		t.Errorf("download of the directory %s: Content-Disposition = %q, want an attachment named %q", dirPath, cd, wantName)
	}
	return readArchive(t, raw)
}

// sameFiles reports every file of want that the archive lacks or holds with
// other bytes, and every file the archive holds beyond them. prefix is where
// the files sit in the archive.
func sameFiles(t *testing.T, got archive, prefix string, want []sentFile) {
	t.Helper()
	for _, f := range want {
		name := prefix + f.relativePath
		content, ok := got.files[name]
		if !ok {
			t.Errorf("the archive has no %s", name)
			continue
		}
		if !bytes.Equal(content, f.content) {
			t.Errorf("%s came back as %d bytes that differ from the %d uploaded [gateway %s]",
				name, len(content), len(f.content), gatewayVersion)
		}
	}
	if len(got.files) != len(want) {
		var names []string
		for name := range got.files {
			names = append(names, name)
		}
		sort.Strings(names)
		t.Errorf("the archive holds %d files, want %d: %q", len(got.files), len(want), names)
	}
}

// TestDirectoryTransfer covers what `openshell sandbox upload` and
// `openshell sandbox download` do with a directory: a folder goes up with its
// structure, and a directory comes down as the tar the CLI unpacks, made by
// the same command in the sandbox.
//
// Download is two calls on the gateway's non-interactive exec. One asks what
// the path is, through the SDK's Exec().Run; the other streams it, through
// Exec().Stream, so the BFF relays the gateway's messages as they arrive
// instead of collecting them.
func TestDirectoryTransfer(t *testing.T) {
	ws, name := sharedSandbox(t)
	root := "/sandbox/" + randName("dir")

	// Every byte value, in a file that takes several stream messages.
	binary := binaryPayload(300 << 10)
	tree := []sentFile{
		{relativePath: "project/README.md", content: []byte("# compat\n")},
		{relativePath: "project/src/main.go", content: []byte("package main\n\nfunc main() {}\n")},
		{relativePath: "project/src/deep/er/data.bin", content: binary},
		{relativePath: "project/empty.txt", content: nil},
		{relativePath: "project/with space/día.txt", content: []byte("accents and spaces\n")},
		{relativePath: "project/-dash/--help", content: []byte("not an option\n")},
	}

	t.Run("a folder goes up with its structure and comes down as a tar", func(t *testing.T) {
		// Nothing below root exists yet: the upload makes the directories.
		mustUploadFiles(t, ws, name, root, tree...)

		got := mustDownloadArchive(t, ws, name, root, strings.TrimPrefix(root, "/sandbox/")+".tar")
		sameFiles(t, got, "./", tree)
		wantDirs := []string{"./", "./project/", "./project/-dash/", "./project/src/", "./project/src/deep/",
			"./project/src/deep/er/", "./project/with space/"}
		if strings.Join(got.dirs, "|") != strings.Join(wantDirs, "|") {
			t.Errorf("directories in the archive = %q, want %q", got.dirs, wantDirs)
		}
	})

	t.Run("a directory below it is archived from its own root", func(t *testing.T) {
		got := mustDownloadArchive(t, ws, name, root+"/project/src", "src.tar")
		sameFiles(t, got, "./", []sentFile{
			{relativePath: "main.go", content: tree[1].content},
			{relativePath: "deep/er/data.bin", content: binary},
		})
	})

	t.Run("a trailing slash changes nothing", func(t *testing.T) {
		got := mustDownloadArchive(t, ws, name, root+"/project/src/", "src.tar")
		if len(got.files) != 2 {
			t.Errorf("the archive holds %d files, want 2", len(got.files))
		}
	})

	t.Run("a file in the folder still downloads as itself", func(t *testing.T) {
		got, header := mustDownload(t, ws, name, root+"/project/src/deep/er/data.bin")
		if !bytes.Equal(got, binary) {
			t.Errorf("downloaded %d bytes that differ from the %d uploaded", len(got), len(binary))
		}
		if ct := header.Get("Content-Type"); ct != "application/octet-stream" {
			t.Errorf("Content-Type = %q, want application/octet-stream", ct)
		}
		if got, _ := mustDownload(t, ws, name, root+"/project/empty.txt"); len(got) != 0 {
			t.Errorf("the empty file came back with %d bytes", len(got))
		}
		if got, _ := mustDownload(t, ws, name, root+"/project/-dash/--help"); string(got) != "not an option\n" {
			t.Errorf("the file named --help came back as %q", got)
		}
	})

	t.Run("each file in a request of its own", func(t *testing.T) {
		// The way the Files tab sends a folder.
		dest := root + "/one-by-one"
		for _, f := range tree {
			mustUploadFiles(t, ws, name, dest, f)
		}
		sameFiles(t, mustDownloadArchive(t, ws, name, dest, "one-by-one.tar"), "./", tree)
	})

	t.Run("one file of a request fails and the rest are written", func(t *testing.T) {
		dest := root + "/partial"
		// "taken" is written as a file, so the file below it cannot be: the
		// sandbox refuses to make a directory where a file is.
		status, raw, err := uploadFiles(ws, name, dest,
			sentFile{relativePath: "a.txt", content: []byte("a")},
			sentFile{relativePath: "taken", content: []byte("b")},
			sentFile{relativePath: "taken/inside.txt", content: []byte("c")},
			sentFile{relativePath: "z.txt", content: []byte("z")},
		)
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		checkError(t, "upload with a file below a file", status, raw, http.StatusBadGateway, "upload_failed")
		var res uploadedFiles
		mustDecode(t, raw, &res)
		if len(res.Files) != 4 {
			t.Fatalf("the answer accounts for %d files, want 4; body: %s", len(res.Files), truncate(raw))
		}
		for i, wantWritten := range []bool{true, true, false, true} {
			if res.Files[i].Success != wantWritten {
				t.Errorf("file %d (%s): success = %v, want %v; error %q",
					i, res.Files[i].Path, res.Files[i].Success, wantWritten, res.Files[i].Error)
			}
		}
		if res.Files[2].Error == "" {
			t.Error("the file that was not written carries no reason")
		}
		if got, _ := mustDownload(t, ws, name, dest+"/z.txt"); string(got) != "z" {
			t.Errorf("the file after the one that failed came back as %q", got)
		}
	})

	t.Run("links", func(t *testing.T) {
		tm := openTerminal(t, ws, name)
		tm.run("cd " + root + "/project && ln -s README.md link-to-file && ln -s src link-to-dir && echo linked-$((1+1))")
		tm.waitFor("linked-2")

		// In an archive a link stays a link, as it does for the CLI.
		got := mustDownloadArchive(t, ws, name, root+"/project", "project.tar")
		if got.links["./link-to-file"] != "README.md" || got.links["./link-to-dir"] != "src" {
			t.Errorf("links in the archive = %v, want link-to-file -> README.md and link-to-dir -> src", got.links)
		}
		// Asked for by name, a link is what it points at.
		if file, _ := mustDownload(t, ws, name, root+"/project/link-to-file"); string(file) != "# compat\n" {
			t.Errorf("the link to a file downloaded as %q, want the file's content", file)
		}
		dir := mustDownloadArchive(t, ws, name, root+"/project/link-to-dir", "link-to-dir.tar")
		if !bytes.Equal(dir.files["./deep/er/data.bin"], binary) {
			t.Errorf("the link to a directory did not download as that directory: %d files", len(dir.files))
		}
	})

	// The refusals below reach the browser as the exit code and the message of
	// a command the gateway ran, before a byte of the answer is sent.
	t.Run("a missing path is a 404", func(t *testing.T) {
		for _, missing := range []string{root + "/nope", root + "/nope/", root + "/project/README.md/below-a-file"} {
			status, _, raw, err := downloadFile(ws, name, missing)
			if err != nil {
				t.Fatalf("download %s: %v", missing, err)
			}
			checkError(t, "download of "+missing, status, raw, http.StatusNotFound, "file_not_found")
		}
	})

	t.Run("a path the sandbox user may not read is a 403", func(t *testing.T) {
		tm := openTerminal(t, ws, name)
		tm.run("cd " + root + " && mkdir -p private/dir && echo secret > private/file && chmod 000 private/file private/dir && echo locked-$((1+1))")
		tm.waitFor("locked-2")
		defer func() {
			tm.run("chmod -R u+rwx " + root + "/private; echo unlocked-$((1+1))")
			tm.waitFor("unlocked-2")
		}()

		for _, forbidden := range []string{root + "/private/file", root + "/private/dir", "/root/x"} {
			status, header, raw, err := downloadFile(ws, name, forbidden)
			if err != nil {
				t.Fatalf("download %s: %v", forbidden, err)
			}
			checkError(t, "download of "+forbidden, status, raw, http.StatusForbidden, "permission_denied")
			if cd := header.Get("Content-Disposition"); cd != "" {
				t.Errorf("download of %s: the refusal carries Content-Disposition %q", forbidden, cd)
			}
		}

		// A directory with one member that cannot be read: tar sends the rest
		// and exits non-zero at the end, after the 200. The transfer has to
		// break, so that what arrived is not taken for the directory.
		status, _, raw, err := downloadFile(ws, name, root+"/private")
		if err == nil {
			t.Errorf("download of a directory with an unreadable member [gateway %s]: status %d and %d bytes read to a clean end, want the transfer to break",
				gatewayVersion, status, len(raw))
		}
	})

	t.Run("a device is refused", func(t *testing.T) {
		status, _, raw, err := downloadFile(ws, name, "/dev/zero")
		if err != nil {
			t.Fatalf("download: %v", err)
		}
		checkError(t, "download of /dev/zero", status, raw, http.StatusBadRequest, "invalid_path")
	})
}

// TestLargeFileTransfer sends files that do not fit in one gRPC message the
// gateway accepts, in both directions, on their own and inside an archive.
// Nothing here is held whole by the BFF: an upload is streamed into the
// gateway's interactive exec as the request arrives, and a download is
// relayed from its non-interactive exec as the gateway sends it.
func TestLargeFileTransfer(t *testing.T) {
	ws, name := sharedSandbox(t)
	dest := "/sandbox/" + randName("big")

	// Bytes 0 to 255, over and over: a little more than 1 MiB of them.
	var everyByte [256]byte
	for i := range everyByte {
		everyByte[i] = byte(i)
	}
	files := []sentFile{
		{relativePath: "every-byte.bin", content: bytes.Repeat(everyByte[:], 4100)},
		{relativePath: "five-mib.bin", content: binaryPayload(5 << 20)},
	}

	for _, f := range files {
		t.Run(f.relativePath, func(t *testing.T) {
			mustUploadFiles(t, ws, name, dest, f)
			got, header := mustDownload(t, ws, name, dest+"/"+f.relativePath)
			if !bytes.Equal(got, f.content) {
				t.Fatalf("downloaded %d bytes that differ from the %d uploaded [gateway %s]", len(got), len(f.content), gatewayVersion)
			}
			if cl := header.Get("Content-Length"); cl != "" {
				t.Errorf("Content-Length = %q on a streamed download, want none", cl)
			}
		})
	}

	t.Run("both in one archive", func(t *testing.T) {
		sameFiles(t, mustDownloadArchive(t, ws, name, dest, strings.TrimPrefix(dest, "/sandbox/")+".tar"), "./", files)
	})
}
