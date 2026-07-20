import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";

/**
 * Parameters for createDeck action
 */
export interface CreateDeckParams {
  /** The name of the deck to create. Use "::" to nest decks (e.g., "Languages::Japanese::JLPT::N5") */
  deckName: string;
}

/**
 * Result of createDeck action
 */
export interface CreateDeckResult {
  success: boolean;
  deckId?: number;
  deckName: string;
  message: string;
  created: boolean;
  exists?: boolean;
  parentDeck?: string;
  childDeck?: string;
  /** For nested names, whether the immediate parent deck already existed before this call */
  parentExisted?: boolean;
}

/**
 * Create a new empty Anki deck
 *
 * Supports nested deck names of any depth using "::" separators (e.g.,
 * "Languages::Japanese::JLPT::N5" creates every missing ancestor deck along
 * the way, matching Anki's own behavior). Will not overwrite existing decks.
 *
 * @see https://git.sr.ht/~foosoft/anki-connect#createdeck
 */
export async function createDeck(
  params: CreateDeckParams,
  client: AnkiConnectClient,
): Promise<CreateDeckResult> {
  const { deckName } = params;

  const parts = deckName.split("::");

  // Check for empty parts
  if (parts.some((part) => part.trim() === "")) {
    throw new Error("Deck name parts cannot be empty");
  }

  const isNested = parts.length > 1;
  const parentName = isNested ? parts.slice(0, -1).join("::") : undefined;
  const childName = isNested ? parts[parts.length - 1] : undefined;

  // For nested names, determine whether the immediate parent already exists so
  // we can report accurately (AnkiConnect's createDeck is happy to "create" an
  // already-existing parent silently, so the response otherwise lies).
  let parentExisted: boolean | undefined;
  if (isNested && parentName !== undefined) {
    try {
      const existingDecks = await client.invoke<string[]>("deckNames");
      parentExisted = existingDecks.includes(parentName);
    } catch {
      // If we can't enumerate decks, fall through without parentExisted info.
      parentExisted = undefined;
    }
  }

  // Create the deck using AnkiConnect
  const deckId = await client.invoke<number>("createDeck", {
    deck: deckName,
  });

  if (!deckId) {
    // Check if deck exists by listing all decks
    const existingDecks = await client.invoke<string[]>("deckNames");
    const deckExists = existingDecks.includes(deckName);

    if (deckExists) {
      const result: CreateDeckResult = {
        success: true,
        message: `Deck "${deckName}" already exists`,
        deckName: deckName,
        created: false,
        exists: true,
      };
      if (isNested) {
        result.parentDeck = parentName;
        result.childDeck = childName;
        if (parentExisted !== undefined) {
          result.parentExisted = parentExisted;
        }
      }
      return result;
    }

    throw new Error("Failed to create deck - unknown error");
  }

  const result: CreateDeckResult = {
    success: true,
    deckId: deckId,
    deckName: deckName,
    message: `Successfully created deck "${deckName}"`,
    created: true,
  };

  // If it's a nested structure, report honestly whether the parent chain was
  // created here or already existed.
  if (isNested) {
    result.parentDeck = parentName;
    result.childDeck = childName;
    if (parentExisted !== undefined) {
      result.parentExisted = parentExisted;
      result.message = parentExisted
        ? `Found existing parent deck "${parentName}"; created child deck "${childName}"`
        : `Created parent deck "${parentName}" and child deck "${childName}"`;
    } else {
      // Couldn't determine parent status — fall back to neutral wording.
      result.message = `Created child deck "${childName}" under parent "${parentName}"`;
    }
  }

  return result;
}
