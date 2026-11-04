const form = document.querySelector("#chat-form");
const input = document.querySelector("#prompt");
const send = document.querySelector("#send");
const newChat = document.querySelector("#new-chat");
const messagesEl = document.querySelector("#messages");
const storageKey = "goer.conversation_id";
let conversationId = null;
try { conversationId = sessionStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }

function rememberConversation(id) {
  conversationId = id;
  try {
    if (id) sessionStorage.setItem(storageKey, id);
    else sessionStorage.removeItem(storageKey);
  } catch { /* In-memory sessions still work. */ }
}

function addText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function addMessage(role, content, className = role) {
  return addText(messagesEl, "div", content, `message ${className}`);
}

function renderProduct(parent, product, position = null) {
  const card = addText(parent, "article", "", "product-card");
  if (product.image_url) {
    try {
      const url = new URL(product.image_url);
      if (url.protocol === "https:") {
        const image = document.createElement("img");
        image.src = url.href;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        card.appendChild(image);
      }
    } catch { /* Invalid image URLs are omitted. */ }
  }
  addText(card, "strong", `${position === null ? "" : `${position}. `}${product.name}`);
  addText(card, "p", `${product.display_price} ${product.currency}`);
  addText(card, "p", product.merchant_id, "product-meta");
  return card;
}

function renderCards(parent, cards = []) {
  for (const card of cards) {
    if (card.type === "product_list" && Array.isArray(card.items)) {
      card.items.forEach((product, index) => renderProduct(parent, product, index + 1));
      addText(parent, "p", `Showing ${card.items.length} of ${card.total} matches.`, "product-meta");
    } else if (card.type === "product_detail" && card.product) {
      const element = renderProduct(parent, card.product);
      addText(element, "p", card.description || "");
      if (card.allows_notes) addText(element, "p", "Special instructions are allowed.", "product-meta");
    }
    // Unknown card types and unimplemented actions are intentionally ignored.
  }
}

if (conversationId) addMessage("assistant", "Continuing your previous conversation. Choose New chat to start over.");

newChat.addEventListener("click", () => {
  if (send.disabled) return;
  rememberConversation(null);
  messagesEl.replaceChildren();
  addMessage("assistant", "New conversation. What are you hungry for?");
  input.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || send.disabled) return;
  input.value = "";
  addMessage("user", content);
  send.disabled = true;
  newChat.disabled = true;
  try {
    if (!conversationId) {
      const created = await fetch("/v1/conversations", { method: "POST" });
      if (!created.ok) throw new Error("Could not start a conversation. Please try again.");
      rememberConversation((await created.json()).conversation_id);
    }
    const response = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 404) rememberConversation(null);
      throw new Error(typeof data.detail === "string" ? data.detail : "Request failed. Please try again.");
    }
    const message = addMessage("assistant", data.text);
    renderCards(message, data.cards);
  } catch (error) {
    addMessage("assistant", error.message, "assistant error");
    input.value = content;
  } finally {
    send.disabled = false;
    newChat.disabled = false;
    input.focus();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
});
