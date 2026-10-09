import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_MALAYSIA_AREA, formatMalaysiaArea } from "@/lib/location/malaysia";
import { MalaysiaAreaFields } from "./malaysia-area-fields";

function Harness() {
  const [value, setValue] = useState(EMPTY_MALAYSIA_AREA);
  return <><MalaysiaAreaFields value={value} onChange={setValue} /><output data-testid="saved-area">{formatMalaysiaArea(value)}</output></>;
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.type(screen.getByRole("combobox", { name: `Search ${label}` }), option);
  await user.click(screen.getByRole("option", { name: option }));
}

describe("Malaysia customer area filters", () => {
  it("filters towns and postcodes and clears descendants on state change", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "Bandar / Pekan" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Poskod" })).toBeDisabled();
    await choose(user, "Negeri / Wilayah Persekutuan", "Selangor");
    await choose(user, "Bandar / Pekan", "Batu Caves");
    await choose(user, "Poskod", "68100");
    await user.type(screen.getByLabelText("Taman / neighbourhood (optional)"), "Taman Sri Gombak");
    expect(screen.getByTestId("saved-area")).toHaveTextContent("Taman Sri Gombak, 68100 Batu Caves, Selangor");
    await choose(user, "Negeri / Wilayah Persekutuan", "Sarawak");
    expect(screen.getByTestId("saved-area")).toHaveTextContent(/^Sarawak$/);
    expect(screen.getByRole("combobox", { name: "Poskod" })).toBeDisabled();
    expect(screen.getByLabelText("Taman / neighbourhood (optional)")).toHaveValue("");
    await user.click(screen.getByRole("combobox", { name: "Bandar / Pekan" }));
    expect(screen.queryByRole("option", { name: "Batu Caves" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kuching" })).toBeInTheDocument();
  });
  it("clears postcode and neighbourhood when the town changes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await choose(user, "Negeri / Wilayah Persekutuan", "Selangor");
    await choose(user, "Bandar / Pekan", "Batu Caves");
    await choose(user, "Poskod", "68100");
    await user.type(screen.getByLabelText("Taman / neighbourhood (optional)"), "Old neighbourhood");
    await choose(user, "Bandar / Pekan", "Puchong");
    expect(screen.getByTestId("saved-area")).toHaveTextContent(/^Puchong, Selangor$/);
    expect(screen.getByLabelText("Taman / neighbourhood (optional)")).toHaveValue("");
  });
  it("keeps a leading-zero postcode intact through selection and serialization", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await choose(user, "Negeri / Wilayah Persekutuan", "Perlis");
    await choose(user, "Bandar / Pekan", "Kangar");
    await choose(user, "Poskod", "01000");
    expect(screen.getByTestId("saved-area")).toHaveTextContent(/^01000 Kangar, Perlis$/);
  });
  it("allows an unlisted manual location and can return to empty preset filters", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await choose(user, "Negeri / Wilayah Persekutuan", "Selangor");
    await user.click(screen.getByRole("checkbox", { name: "Area not listed? Enter manually" }));
    expect(screen.queryByRole("combobox", { name: "Negeri / Wilayah Persekutuan" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Customer's area", { exact: true }), "Unlisted town");
    expect(screen.getByTestId("saved-area")).toHaveTextContent(/^Unlisted town$/);
    await user.click(screen.getByRole("checkbox", { name: "Area not listed? Enter manually" }));
    expect(screen.getByTestId("saved-area")).toBeEmptyDOMElement();
    expect(screen.getByRole("combobox", { name: "Bandar / Pekan" })).toBeDisabled();
  });
});
