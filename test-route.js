import express from "express";

const app = express();

app.get(/.*/, (req, res, next) => {
    console.log("Matched regex", req.path);
    res.send("matched regex");
});

app.listen(5001, () => {
    console.log("Server listening on 5001");
});
