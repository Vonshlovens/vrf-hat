import type { User, Session } from "better-auth";

declare global {
  interface Window {
    /** Injected by MetaMask and other browser wallets. */
    ethereum?: import("viem").EIP1193Provider;
  }

  namespace App {
    interface Locals {
      user?: User;
      session?: Session;
    }
  }
}

export {};
