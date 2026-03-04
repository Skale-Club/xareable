async function test() {
    try {
        const res = await fetch("http://localhost:3000/api/landing/content");
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Content-Type:", res.headers.get("content-type"));
        console.log("Body preview:", text.substring(0, 500));
    } catch (e) {
        console.error("Fetch failed:", e.message);
    }
}

test();
