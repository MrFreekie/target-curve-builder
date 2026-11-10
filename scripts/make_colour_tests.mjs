// Writes the two Smaart colour-test curves into reference/manual/ using the app's own writer.
// Run: node scripts/make_colour_tests.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { evaluate } from "../js/curve.js";
import { newDoc } from "../js/doc.js";
import { writeTf } from "../js/formats/smaart.js";

mkdirSync(new URL("../reference/manual/", import.meta.url), { recursive: true });
const make = (file, name, color, db) => {
  const doc = newDoc();
  doc.grid.fraction = 3;
  doc.layers[0].points = [[20, db], [20000, db]];
  Object.assign(doc.props, { name, color, line: 3 });
  writeFileSync(new URL(`../reference/manual/${file}`, import.meta.url), writeTf(doc, evaluate(doc)));
};
make("colour_test_green.crv", "colour_test_green", "ff00ff00", 6);
make("colour_test_blue.crv", "colour_test_blue", "ff0000ff", -6);
console.log("wrote reference/manual/colour_test_green.crv and colour_test_blue.crv");
