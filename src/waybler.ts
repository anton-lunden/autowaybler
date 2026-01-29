import { logger } from "./logger.js";

// --- Types ---

interface LoginResponse {
  token: string;
}

interface ConsumptionFee {
  currency: string;
  vat: number;
  value: number;
  total: number;
}

export interface PriceListEntry {
  at: string;
  consumptionFee: ConsumptionFee;
}

type StationState = "EvConnected" | "Busy" | "Ok" | "Unknown";

interface Station {
  stationId: number;
  name: string;
  state: StationState;
}

interface StationGroup {
  stations: Station[];
  name: string;
}

interface ChargeZoneModel {
  modelType: "ChargeZoneModel";
  zoneId: number;
  name: string;
  contractUserId: number;
  stationGroups: StationGroup[];
  isVariablePriceZone: boolean;
  spotPriceLimit: number | null;
  priceList: PriceListEntry[];
  currency: string;
  [key: string]: unknown;
}

interface CreateChargeSessionRequest {
  modelType: "CreateChargeSessionRequest";
  stationId: number;
  contractUserId: number;
  spotPriceLimit: number;
}

interface CreateChargeSessionResponse {
  modelType: "CreateChargeSessionResponse";
  result: string;
  contractUserId: string;
  sessionId: number;
}

// --- Client ---

const BASE_URL = "https://api.waybler.com/v7";
const APP_UUID = "8d0a2cfa-4373-43e2-951a-8bff7c25d4d7";

export class WayblerClient {
  private token: string | null = null;
  private userId: string | null = null;
  private ws: WebSocket | null = null;
  private chargeZones: Map<number, ChargeZoneModel> = new Map();
  constructor(private config: { username: string; password: string }) {}

  async initialize(): Promise<void> {
    await this.login();
    await this.connectWebSocket();
  }

  isVehicleConnected(): boolean {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "EvConnected" || station.state === "Busy")
            return true;
        }
      }
    }
    return false;
  }

  isCharging(): boolean {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "Busy") return true;
        }
      }
    }
    return false;
  }

  getLowestPrice(lookAheadHours: number): PriceListEntry | null {
    const now = new Date();
    const cutoff = new Date(now.getTime() + lookAheadHours * 60 * 60 * 1000);

    let lowest: PriceListEntry | null = null;

    for (const zone of this.chargeZones.values()) {
      for (const entry of zone.priceList) {
        const entryTime = new Date(entry.at);
        if (entryTime >= now && entryTime <= cutoff) {
          if (
            !lowest ||
            entry.consumptionFee.total < lowest.consumptionFee.total
          ) {
            lowest = entry;
          }
        }
      }
    }

    return lowest;
  }

  async startCharging(
    spotPriceLimit: number,
  ): Promise<CreateChargeSessionResponse | null> {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "EvConnected") {
            const body: CreateChargeSessionRequest = {
              modelType: "CreateChargeSessionRequest",
              stationId: station.stationId,
              contractUserId: zone.contractUserId,
              spotPriceLimit,
            };
            const res = await this.apiFetch(`/${this.userId}/sessions/charge`, {
              method: "PUT",
              body: JSON.stringify(body),
            });
            return (await res.json()) as CreateChargeSessionResponse;
          }
        }
      }
    }
    return null;
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  // --- Private ---

  private async login(): Promise<void> {
    const res = await this.apiFetch(
      "/app/authenticate/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: this.config.username,
          password: this.config.password,
        }),
      },
      false,
    );

    const data = (await res.json()) as LoginResponse;
    this.token = data.token;
    this.userId = this.parseUserId(data.token);

    if (!this.userId) {
      throw new Error("Could not parse user ID from token.");
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WebSocket init timeout")),
        30000,
      );

      const url = `wss://api.waybler.com/v7/app/websocket?jwt=${this.token}&app-uuid=${APP_UUID}`;
      this.ws = new WebSocket(url);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg?.modelType) return;

          if (msg.modelType === "ChargeZoneModel") {
            this.chargeZones.set(msg.zoneId, msg as ChargeZoneModel);
          } else if (msg.modelType === "WebsocketInitMessage") {
            clearTimeout(timeout);
            resolve();
          }
        } catch (e) {
          // Log parse errors for debugging, but don't fail
          logger.error(e, "Failed to parse WebSocket message");
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket closed unexpectedly"));
      };
    });
  }

  private async apiFetch(
    endpoint: string,
    options: RequestInit,
    auth = true,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("x-app-uuid", APP_UUID);
    if (auth) headers.set("Authorization", `Bearer ${this.token}`);
    if (options.body)
      headers.set("Content-Type", "application/json; charset=utf-8");

    const res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res;
  }

  private parseUserId(token: string): string | null {
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
      );
      return (
        payload[
          "http://schemas.microsoft.com/ws/2008/06/identity/claims/userdata"
        ] ?? null
      );
    } catch {
      return null;
    }
  }
}
