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

function auto_resize() {
    const ta = document.getElementById("fileList");
    if (!ta) return;

    ta.style.width = "auto";

    const scrollbarBuffer = 20;
    const newWidth = ta.scrollWidth + scrollbarBuffer;

    ta.style.width = newWidth + "px";

    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
}