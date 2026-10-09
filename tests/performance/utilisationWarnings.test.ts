import { UtilisationWarningMonitor } from "../../src/application/utilisationWarnings.js";

test("warns once per threshold crossing and rearms after recovery", () => {
  const warnings: number[] = [];
  const monitor = new UtilisationWarningMonitor((threshold) => warnings.push(threshold));
  for (const depth of [69, 70, 80, 85, 96, 99, 60, 71]) monitor.observe(depth, 100);
  expect(warnings).toEqual([0.7, 0.85, 0.95, 0.7]);
});
