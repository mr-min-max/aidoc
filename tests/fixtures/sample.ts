import { EventEmitter } from "events";

/**
 * Represents a user in the system.
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Configuration options for the service */
export type ServiceConfig = {
  host: string;
  port: number;
  debug?: boolean;
};

/**
 * A service that manages users.
 */
export class UserService extends EventEmitter {
  private users: Map<string, User> = new Map();

  constructor(private config: ServiceConfig) {
    super();
  }

  /**
   * Add a new user to the service.
   * @param user - The user to add
   * @returns The added user
   */
  async addUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    this.emit("user:added", user);
    return user;
  }

  /** Get a user by ID */
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }
}

/**
 * Creates a greeting message for a user.
 */
export function greetUser(user: User): string {
  return `Hello, ${user.name}!`;
}

export async function fetchData(
  url: string,
  _retries: number = 3,
): Promise<unknown> {
  // implementation
  return {};
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const internalHelper = () => "not exported";
