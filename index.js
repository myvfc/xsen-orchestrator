Starting Container
npm warn config production Use `--omit=dev` instead.
> xsen-orchestrator@1.0.0 start
> node index.js
🧠 Loaded 304 trivia questions
🚀 XSEN Orchestrator running on port 8080
Stopping Container
npm error path /app
npm error command failed
npm error signal SIGTERM
npm error command sh -c node index.js
npm error A complete log of this run can be found in: /root/.npm/_logs/2026-01-18T20_09_13_603Z-debug-0.log
❌ Orchestrator error: TypeError: Cannot read properties of undefined (reading 'map')
    at file:///app/index.js:177:10
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at /app/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/app/node_modules/express/lib/router/index.js:346:12)
    at next (/app/node_modules/express/lib/router/index.js:280:10)
    at /app/node_modules/body-parser/lib/read.js:137:5
    at AsyncResource.runInAsyncScope (node:async_hooks:214:14)
❌ Orchestrator error: TypeError: Cannot read properties of undefined (reading 'map')
    at file:///app/index.js:177:10
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at /app/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/app/node_modules/express/lib/router/index.js:346:12)
    at next (/app/node_modules/express/lib/router/index.js:280:10)
    at /app/node_modules/body-parser/lib/read.js:137:5
    at AsyncResource.runInAsyncScope (node:async_hooks:214:14)
