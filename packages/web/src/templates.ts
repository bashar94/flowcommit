import type { DraftFlow } from "@flowcommit/shared";

export type Template = { id: string; title: string; blurb: string; description: string; flow: DraftFlow };

/** Starting points that work without any AI tool installed. */
export const TEMPLATES: Template[] = [
  {
    id: "auth",
    title: "Sign up and log in",
    blurb: "Email sign-up, log in, password reset",
    description: "Accounts for a web app: people sign up with email and password, log in, and reset a forgotten password.",
    flow: {
      name: "Sign up and log in",
      steps: [
        { id: "s1", kind: "start", title: "Visitor opens the app", instructions: "" },
        { id: "s2", kind: "decision", title: "Has an account?", instructions: "Check for a saved session first and skip straight to the dashboard if it's still valid." },
        { id: "s3", kind: "screen", title: "Sign-up form", instructions: "Ask for name, email and password. Password must be at least 8 characters. Show errors under each field." },
        { id: "s4", kind: "screen", title: "Log-in form", instructions: "Ask for email and password. Link to 'Forgot password?'. After 5 failed tries, wait 1 minute." },
        { id: "s5", kind: "api", title: "Create account", instructions: "Hash the password, reject emails that are already registered, start a session." },
        { id: "s6", kind: "api", title: "Check credentials", instructions: "Compare the password hash. Return the same error for a wrong email or password." },
        { id: "s7", kind: "data", title: "Users table", instructions: "id, name, email (unique), password_hash, created_at." },
        { id: "s8", kind: "screen", title: "Dashboard", instructions: "Greet the user by name and show a log-out button." },
        { id: "s9", kind: "end", title: "Signed in", instructions: "" },
      ],
      arrows: [
        { from: "s1", to: "s2", label: "" },
        { from: "s2", to: "s3", label: "No" },
        { from: "s2", to: "s4", label: "Yes" },
        { from: "s3", to: "s5", label: "" },
        { from: "s4", to: "s6", label: "" },
        { from: "s5", to: "s7", label: "" },
        { from: "s6", to: "s7", label: "" },
        { from: "s7", to: "s8", label: "" },
        { from: "s8", to: "s9", label: "" },
      ],
    },
  },
  {
    id: "store",
    title: "Online store checkout",
    blurb: "Products, cart, payment, order email",
    description: "A small online store: shoppers browse products, add them to a cart, pay by card and get an order confirmation email.",
    flow: {
      name: "Online store",
      steps: [
        { id: "s1", kind: "start", title: "Shopper lands on store", instructions: "" },
        { id: "s2", kind: "screen", title: "Product list", instructions: "Grid of products with photo, name and price. Filter by category." },
        { id: "s3", kind: "screen", title: "Cart", instructions: "List items with quantity controls and a running total. Keep the cart if the page reloads." },
        { id: "s4", kind: "screen", title: "Checkout form", instructions: "Shipping address and card details. Validate before sending." },
        { id: "s5", kind: "api", title: "Charge the card", instructions: "Create the payment with the payment provider. Never store card numbers." },
        { id: "s6", kind: "decision", title: "Payment succeeded?", instructions: "" },
        { id: "s7", kind: "data", title: "Save the order", instructions: "orders: id, items, total, address, status, created_at." },
        { id: "s8", kind: "screen", title: "Payment failed", instructions: "Explain what went wrong and let the shopper try another card without retyping the address." },
        { id: "s9", kind: "end", title: "Confirmation email sent", instructions: "Email the order summary and show a thank-you page." },
      ],
      arrows: [
        { from: "s1", to: "s2", label: "" },
        { from: "s2", to: "s3", label: "Add to cart" },
        { from: "s3", to: "s4", label: "" },
        { from: "s4", to: "s5", label: "" },
        { from: "s5", to: "s6", label: "" },
        { from: "s6", to: "s7", label: "Yes" },
        { from: "s6", to: "s8", label: "No" },
        { from: "s8", to: "s4", label: "Try again" },
        { from: "s7", to: "s9", label: "" },
      ],
    },
  },
  {
    id: "habits",
    title: "Habit tracker",
    blurb: "Daily check-ins and streaks",
    description: "A habit tracker: people add habits, check in once a day, and see their current streak for each habit.",
    flow: {
      name: "Habit tracker",
      steps: [
        { id: "s1", kind: "start", title: "User opens the app", instructions: "" },
        { id: "s2", kind: "decision", title: "Any habits yet?", instructions: "" },
        { id: "s3", kind: "screen", title: "Add a habit", instructions: "Name and an optional emoji. Suggest 3 common habits to tap." },
        { id: "s4", kind: "screen", title: "Today's habits", instructions: "One row per habit with a big check button and the current streak." },
        { id: "s5", kind: "api", title: "Record check-in", instructions: "One check-in per habit per day. Tapping again undoes it." },
        { id: "s6", kind: "data", title: "Check-ins", instructions: "habit_id, date (unique together), created_at." },
        { id: "s7", kind: "end", title: "Streak updated", instructions: "Animate the streak number going up." },
      ],
      arrows: [
        { from: "s1", to: "s2", label: "" },
        { from: "s2", to: "s3", label: "No" },
        { from: "s2", to: "s4", label: "Yes" },
        { from: "s3", to: "s4", label: "" },
        { from: "s4", to: "s5", label: "Check in" },
        { from: "s5", to: "s6", label: "" },
        { from: "s6", to: "s7", label: "" },
      ],
    },
  },
];
