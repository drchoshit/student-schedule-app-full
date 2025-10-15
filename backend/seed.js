import { run } from "./db.js";
for (const [code,name] of [['dfv201','강민준'],['abc123','김도윤'],['xyz456','이서준']]) {
  await run(`INSERT INTO students(code,name) VALUES(?,?)
             ON CONFLICT(code) DO UPDATE SET name=excluded.name`, [code,name]);
}
console.log("Seed done.");