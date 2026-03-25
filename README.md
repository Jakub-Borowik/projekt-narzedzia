# Projekt Narzędzia – RPN Calculator

A web-based calculator that uses **Reverse Polish Notation (RPN)**, also known as **ONP** (*Odwrotna Notacja Polska*), for expression evaluation. Built with Node.js/Express and containerised with Docker.

---

## Table of Contents

- [Getting Started](#getting-started)
- [CI/CD Pipeline](#cicd-pipeline)
- [ONP / RPN Inner Workings](#onp--rpn-inner-workings)

---

## Getting Started

```bash
npm install        # install dependencies
npm start          # run production server on port 4200
npm run dev        # run with auto-reload (nodemon)
npm test           # run tests
npm run test:ci    # run tests in CI mode (coverage, no watch)
```

---

## CI/CD Pipeline

The pipeline is defined in `.github/workflows/Build and deploy docker image.yml` and runs on:

- Every **push** to `main`
- Every **pull request** targeting `main`
- Manually via **workflow_dispatch**

### Jobs

```
push / PR to main
       │
       ▼
  ┌─────────┐
  │  test   │   (ubuntu-latest)
  └────┬────┘
       │  passes
       ▼
  ┌──────────────────┐
  │ build-and-publish │   (ubuntu-latest)
  └──────────────────┘
```

#### 1. `test`

| Step | Action |
|------|--------|
| Checkout | `actions/checkout@v4` |
| Set up Node.js 18 | `actions/setup-node@v4` with npm cache |
| Install deps | `npm ci` |
| Run tests | `npm run test:ci` (Jest, with coverage) |
| Upload coverage | `actions/upload-artifact@v4` → artifact `coverage-report` |

#### 2. `build-and-publish`

Runs only after `test` passes (`needs: test`).

| Step | Action |
|------|--------|
| Checkout | `actions/checkout@v4` |
| Set up Docker Buildx | `docker/setup-buildx-action@v3` |
| Log in to GHCR | `docker/login-action@v3` – skipped on pull requests |
| Extract metadata | `docker/metadata-action@v5` – generates image tags (see below) |
| Build & push image | `docker/build-push-action@v5` – targets `production` stage |

**Image tags** generated automatically:

| Trigger | Tag |
|---------|-----|
| Branch push | branch name (e.g. `main`) |
| Pull request | `pr-<number>` |
| Any push | `sha-<short-sha>` |
| Default branch | `latest` |

**Platforms built:** `linux/amd64`, `linux/arm64`  
**Registry:** `ghcr.io/<owner>/<repo>`  
**Push policy:** images are pushed only on non-pull-request events.  
**Cache:** GitHub Actions cache (`type=gha`) is used to speed up subsequent builds.

### Docker multi-stage build

The `Dockerfile` uses four stages:

1. **base** – Node 18 Alpine, copies `package*.json`
2. **dependencies** – runs `npm ci`
3. **test** – runs `npm run test:ci` (build fails if tests fail)
4. **production** – minimal image, non-root user (`nodejs:1001`), exposes port `4200`

---

## ONP / RPN Inner Workings

The calculator converts a standard (infix) expression entered by the user into **Reverse Polish Notation** and then evaluates it. The logic lives in `static/rpn.js`.

### Operator Precedence

| Operator | Symbol | Precedence | Associativity |
|----------|--------|-----------|---------------|
| `+` | addition | 2 | left |
| `-` | subtraction | 2 | left |
| `*` | multiplication | 3 | left |
| `/` | division | 3 | left |
| `^` | exponentiation | 4 | right |
| `@` | square root (√) | 4 | right |
| `!` | nth root (ⁿ√x) | 4 | right |

### Step 1 – Building the token list

As the user presses buttons, the application maintains two pieces of state:

- `number` – the digit string currently being typed
- `tokens` – an ordered array of completed numbers and operators (the infix expression)

Each input type is handled as follows:

#### Digit input (`addDigit`)
- A leading `0` is never doubled (`00` → stays `0`)
- A decimal point is accepted only once per number
- A bare `.` is expanded to `0.`

#### Operator input (`addOperator`)
- If a number is being typed, it is flushed to `tokens` first
- If the last token is already an operator it is **replaced** (prevents `3 + - +` sequences)
- An operator after an open bracket `(` is ignored

#### Bracket input (`addBracket`)
- Any pending number is flushed to `tokens`
- Opening `(`: increments `bracketOpen`; inserts an implicit `*` when the preceding token is a number
- Closing `)`: accepted only when `bracketOpen > 0` and the last token is not an operator

#### Backspace / clear (`clearDisplay`)
- `"all"` resets `tokens` and `number` to empty
- `"input"` (backspace):
  1. If `number` is non-empty → remove its last character
  2. Otherwise pop the last token: number tokens are restored to `number` (with last char removed); operators and brackets are simply removed (closing brackets also restore the `bracketOpen` counter)

### Step 2 – Infix → RPN (`infixToRpn`)

Implements the **Shunting Yard algorithm** (Dijkstra, 1961).

**Data structures:**
- `equationQueue` – output queue (will become the RPN array)
- `operatorStack` – temporary operator stack

**Rules applied to each token:**

```
token is a number   →  push to equationQueue

token is '('        →  push to operatorStack

token is ')'        →  pop operatorStack → equationQueue until '(' is found;
                        discard the '('

token is an operator (newOp)  →
    while operatorStack is not empty
      AND top of stack is an operator
      AND (
            (newOp is left-associative  AND  prec[newOp] <= prec[top])
         OR (newOp is right-associative AND  prec[newOp] <  prec[top])
         ):
        pop operatorStack → equationQueue
    push newOp to operatorStack

after all tokens    →  pop remaining operators → equationQueue
```

**Example:** `3 + 4 * 2`

```
Token  │ equationQueue    │ operatorStack
───────┼──────────────────┼──────────────
3      │ [3]              │ []
+      │ [3]              │ [+]
4      │ [3, 4]           │ [+]
*      │ [3, 4]           │ [+, *]   (* has higher prec than +)
2      │ [3, 4, 2]        │ [+, *]
(end)  │ [3, 4, 2, *, +]  │ []

RPN: 3 4 2 * +   →   result: 11
```

### Step 3 – Evaluating the RPN expression (`evaluateEquation`)

Uses a single **number stack**. Tokens are processed left-to-right:

- **Number** → push onto the stack
- **Operator** → pop operands, compute, push result

| Operator | Operands popped (top first) | Computation |
|----------|-----------------------------|-------------|
| `+` | `a`, `b` | `b + a` |
| `-` | `a`, `b` | `b - a` |
| `*` | `a`, `b` | `b * a` |
| `/` | `a`, `b` | `b / a` |
| `^` | `a`, `b` | `b ** a` |
| `@` | `a` | `a ** 0.5`  (√a) |
| `!` | `a`, `b` | `b ** (1/a)`  (ⁿ√b) |

After processing all tokens the single remaining value on the stack is the result.

**Example:** `3 4 2 * +`

```
Token │ Stack
──────┼────────────────
3     │ [3]
4     │ [3, 4]
2     │ [3, 4, 2]
*     │ [3, 8]         pop 2,4 → push 4*2=8
+     │ [11]           pop 8,3 → push 3+8=11

Result: 11
```

### Display

The UI shows two lines simultaneously:

- **Top line** – infix notation (what the user typed)
- **Bottom line** – live RPN equivalent, with operators replaced by readable symbols:

| Internal | Displayed |
|----------|-----------|
| `/` | `÷` |
| `*` | `×` |
| `^` | `**` |
| `@` | `√` |
| `!` | `ⁿ√x` |

The RPN display is recalculated on every keypress by temporarily appending the current `number` to `tokens`, calling `infixToRpn`, and then removing it again.
