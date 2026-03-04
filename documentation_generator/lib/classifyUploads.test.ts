import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { classifyUploads } from "./classifyUploads";

async function createSolutionZip(): Promise<File> {
  const zip = new JSZip();
  zip.file("Other/Solution.xml", "<root/>");
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const file = new File([arrayBuffer], "solution.zip");
  if (typeof file.arrayBuffer !== "function") {
    (file as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = () => Promise.resolve(arrayBuffer);
  }
  return file;
}

describe("classifyUploads", () => {
  it("returns unsupported when no files provided", async () => {
    const result = await classifyUploads([]);
    expect(result.type).toBe("unsupported");
    expect(result.reason).toBe("No files provided");
  });

  it("returns power_platform_solution_zip when zip has solution markers", async () => {
    const zipFile = await createSolutionZip();
    const result = await classifyUploads([zipFile]);
    expect(result.type).toBe("power_platform_solution_zip");
    expect(result.reason).toContain("Power Platform solution");
  });

  it("returns docs when only document extensions are present", async () => {
    const files = [
      new File(["a"], "doc.txt", { type: "text/plain" }),
      new File(["b"], "readme.md", { type: "text/markdown" }),
    ];
    const result = await classifyUploads(files);
    expect(result.type).toBe("docs");
    expect(result.reason).toContain("Document files");
  });

  it("returns docs for single .md file", async () => {
    const result = await classifyUploads([
      new File(["# Hi"], "page.md", { type: "text/markdown" }),
    ]);
    expect(result.type).toBe("docs");
  });

  it("returns unsupported when only unsupported file types", async () => {
    const result = await classifyUploads([
      new File([], "image.png"),
      new File([], "data.xlsx"),
    ]);
    expect(result.type).toBe("unsupported");
    expect(result.reason).toContain("No supported file types");
  });

  it("accepts FileList-like (array from Array.from)", async () => {
    const zipFile = await createSolutionZip();
    const fileList = [zipFile];
    const result = await classifyUploads(fileList);
    expect(result.type).toBe("power_platform_solution_zip");
  });

  it("prioritizes solution zip over docs when both present", async () => {
    const zipFile = await createSolutionZip();
    const files = [
      new File(["x"], "doc.txt"),
      zipFile,
    ];
    const result = await classifyUploads(files);
    expect(result.type).toBe("power_platform_solution_zip");
  });
});
