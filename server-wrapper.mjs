import { createServer, request } from "node:http";
import { parse } from "node:url";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseTrustedProxies, resolveClientIp } from "./trusted-proxy.mjs";

const RELOAD_SCRIPT = "self.__nextStaleAsset=1;location.reload(!0)";

// Diagnostic: capture stdout/stderr separately for debugging.
// server.js exits with code 0 which means the event loop drains cleanly.
// We need to see the full output to understand why.
let childStdout = "";
let childStderr = "";

const original = spawn("node", ["server.js"], {
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, PORT: "3001" },
});

original.stdout.on("data", (data) => {
  childStdout += data.toString();
  process.stdout.write(data);
});

original.stderr.on("data", (data) => {
  childStderr += data.toString();
  process.stderr.write(`[server.js] ${data}`);
});

original.on("error", (err) => {
  console.error("Failed to spawn Next.js server:", err);
  process.exit(1);
});

// Use 'close' instead of 'exit' to ensure all stdio has been flushed from the
// pipe buffers before we inspect it. Next.js server sometimes exits faster than
// the pipe drain, leaving us with 0 captured bytes.
const onChildDone = (code, signal) => {
  console.error(`server.js exited (code=${code} signal=${signal})`);
  if (code === 0) {
    console.error("=".repeat(60));
    console.error("DIAGNOSTIC: Next.js server exited with code 0 (clean exit)");
    console.error(`Signal: ${signal}`);
    console.error(`Stdout (${childStdout.length} bytes):`);
    console.error(childStdout || "(empty)");
    console.error(`Stderr (${childStderr.length} bytes):`);
    console.error(childStderr || "(empty)");
    console.error("=".repeat(60));
    console.error(`CWD: ${process.cwd()}`);
    console.error(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.error(`PORT: ${process.env.PORT}`);
    console.error(`HOSTNAME: ${process.env.HOSTNAME}`);
    try {
      console.error(`/app/server.js exists: ${existsSync("/app/server.js")}`);
      console.error(`/app/.next/BUILD_ID: ${readFileSync("/app/.next/BUILD_ID", "utf8").trim()}`);
      console.error(`/app/package.json exists: ${existsSync("/app/package.json")}`);
      console.error(`/app/node_modules/next exists: ${existsSync("/app/node_modules/next")}`);
      console.error(`/app/node_modules/@next (SWC) exists: ${existsSync("/app/node_modules/@next")}`);
      if (existsSync("/app/node_modules/@next")) {
        console.error(`SWC pkgs: ${readdirSync("/app/node_modules/@next").join(", ")}`);
      }
    } catch (e) {
      console.error(`Diagnostic file check error: ${e.message}`);
    }
  }
  process.exit(code || 1);
};

original.on("exit", (code, signal) => {
  // On exit, mark that the child ended but wait for pipes to drain.
  // We handle the final dump in the 'close' event below.
  console.error(`[child exit] code=${code} signal=${signal}`);
});

original.on("close", (code, signal) => {
  console.error(`[child close] code=${code} signal=${signal}  stdoutBytes=${childStdout.length} stderrBytes=${childStderr.length}`);
  onChildDone(code, signal);
});

// Forward shutdown signals from Docker to the child so `docker stop` doesn't
// hit the 10s SIGKILL timeout waiting for us to die.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (!original.killed) original.kill(sig);
  });
}

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Startup timeout")), 30000);
  const check = () => {
    const req = request(
      { hostname: "127.0.0.1", port: 3001, path: "/", method: "HEAD" },
      (res) => {
        clearTimeout(timeout);
        resolve();
      }
    );
    req.on("error", () => setTimeout(check, 500));
    req.end();
  };
  check();
});

console.log("> Proxy ready on http://0.0.0.0:3000");

const TRUSTED_PROXIES = parseTrustedProxies(process.env.TRUSTED_PROXY_IPS);
if (TRUSTED_PROXIES.size === 0) {
  console.warn(
    "> TRUSTED_PROXY_IPS is not set: X-Forwarded-For is ignored, so behind a reverse " +
      "proxy every user shares the proxy's IP for rate limiting and the audit log."
  );
}

/** The client's headers, with X-Real-IP overwritten by the address we trust. */
function forwardedHeaders(clientReq) {
  return {
    ...clientReq.headers,
    "x-real-ip": resolveClientIp(
      clientReq.socket.remoteAddress,
      clientReq.headers["x-forwarded-for"],
      TRUSTED_PROXIES
    ),
  };
}

createServer((clientReq, clientRes) => {
  const parsedUrl = parse(clientReq.url, true);

  if (parsedUrl.pathname?.startsWith("/_next/static/")) {
    const proxyReq = request(
      {
        hostname: "127.0.0.1",
        port: 3001,
        path: clientReq.url,
        method: clientReq.method,
        headers: forwardedHeaders(clientReq),
      },
      (proxyRes) => {
        if (proxyRes.statusCode === 404) {
          clientRes.writeHead(200, {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store, must-revalidate",
            "CDN-Cache-Control": "no-store",
          });
          clientRes.end(RELOAD_SCRIPT);
          return;
        }
        clientRes.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(clientRes);
      }
    );
    proxyReq.on("error", () => {
      clientRes.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      });
      clientRes.end(RELOAD_SCRIPT);
    });
    clientReq.pipe(proxyReq);
    return;
  }

  const proxyReq = request(
    {
      hostname: "127.0.0.1",
      port: 3001,
      path: clientReq.url,
      method: clientReq.method,
      headers: forwardedHeaders(clientReq),
    },
    (proxyRes) => {
      const isHtml = (proxyRes.headers["content-type"] ?? "")
        .toLowerCase()
        .includes("text/html");

      clientRes.statusCode = proxyRes.statusCode ?? 200;
      for (const [k, v] of Object.entries(proxyRes.headers ?? {})) {
        if (k === "cache-control" && isHtml) {
          clientRes.setHeader(k, "no-store, must-revalidate");
        } else if (v != null) {
          clientRes.setHeader(k, v);
        }
      }
      proxyRes.pipe(clientRes);
    }
  );
  proxyReq.on("error", () => {
    clientRes.statusCode = 502;
    clientRes.end("Bad Gateway");
  });
  clientReq.pipe(proxyReq);
}).listen(3000, "0.0.0.0");
