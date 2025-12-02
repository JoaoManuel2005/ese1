function import_file() {
    const fileInput = document.getElementById("fileInput");
    const fileList = document.getElementById("fileList");

    if (!fileInput || !fileList) return;

    fileInput.click();

    fileInput.onchange = () => {
        if (!fileInput.files) return;

        for (const file of fileInput.files) {
            fileList.value += (fileList.value ? "\n" : "") + file.name;
        }
        auto_resize();
    };
}