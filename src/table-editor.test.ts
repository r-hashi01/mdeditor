import { afterEach, describe, expect, it } from "vitest";
import { createTableEditor } from "./table-editor";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createTableEditor", () => {
  it("escapes header values when re-rendering column inputs", () => {
    createTableEditor(() => {});

    const firstInput = document.querySelector<HTMLInputElement>(".te-header-input");
    expect(firstInput).toBeTruthy();
    const payload = `"><img src=x onerror=alert(1)>`;
    firstInput!.value = payload;
    firstInput!.dispatchEvent(new Event("input", { bubbles: true }));

    const colsInput = document.getElementById("te-cols") as HTMLInputElement;
    colsInput.value = "4";
    colsInput.dispatchEvent(new Event("input", { bubbles: true }));

    const config = document.getElementById("te-columns-config") as HTMLElement;
    expect(config.querySelector("img")).toBeNull();

    const rerendered = document.querySelector<HTMLInputElement>('.te-header-input[data-idx="0"]');
    expect(rerendered?.value).toBe(payload);
  });
});
