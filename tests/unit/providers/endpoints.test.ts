import { lookup as nodeLookup } from "node:dns/promises";
import {
  approveCompatibleEndpoint,
  buildQwenPaygEndpoint,
} from "../../../src/providers/endpoints";

function publicLookup(address = "203.0.113.10", family: 4 | 6 = 4) {
  return jest.fn().mockResolvedValue([{ address, family }]);
}

describe("compatible provider endpoint approval", () => {
  it("normalizes a public HTTPS endpoint and returns approved addresses", async () => {
    const endpoint = await approveCompatibleEndpoint({
      rawUrl: "https://gateway.example.com/v1",
      allowLocalHttp: false,
      lookup: publicLookup("93.184.216.34"),
    });

    expect(endpoint.url.href).toBe("https://gateway.example.com/v1");
    expect(endpoint.origin).toBe("https://gateway.example.com");
    expect(endpoint.local).toBe(false);
    expect(endpoint.addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("approves explicit loopback HTTP only with local permission", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://127.0.0.1:8080/v1",
        allowLocalHttp: false,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_LOCAL_HTTP_NOT_CONFIRMED" });

    const ipv4 = await approveCompatibleEndpoint({
      rawUrl: "http://127.0.0.1:8080/v1",
      allowLocalHttp: true,
    });
    expect(ipv4.local).toBe(true);
    expect(ipv4.addresses).toEqual([{ address: "127.0.0.1", family: 4 }]);

    const ipv6 = await approveCompatibleEndpoint({
      rawUrl: "http://[::1]:8080/v1",
      allowLocalHttp: true,
    });
    expect(ipv6.local).toBe(true);
    expect(ipv6.addresses).toEqual([{ address: "::1", family: 6 }]);
  });

  it.each([
    "https://user:password@gateway.example.com/v1",
    "https://gateway.example.com/v1?token=secret",
    "https://gateway.example.com/v1#fragment",
    "ftp://gateway.example.com/v1",
    "http://gateway.example.com/v1",
  ])("rejects unsafe URL syntax or protocol: %s", async (rawUrl) => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl,
        allowLocalHttp: false,
        lookup: publicLookup("93.184.216.34"),
      }),
    ).rejects.toMatchObject({ code: expect.any(String) });
  });

  it("rejects localhost without explicit local-http permission", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://localhost:11434/v1",
        allowLocalHttp: false,
        lookup: jest.fn().mockResolvedValue([
          { address: "127.0.0.1", family: 4 },
          { address: "::1", family: 6 },
        ]),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_LOCAL_HTTP_NOT_CONFIRMED" });
  });

  it("rejects localhost when DNS does not return loopback addresses", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://localhost:8080/v1",
        allowLocalHttp: true,
        lookup: publicLookup("93.184.216.34"),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it("rejects a non-local hostname that resolves to loopback", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://gateway.example.com/v1",
        allowLocalHttp: true,
        lookup: publicLookup("127.0.0.1"),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it("does not turn an HTTPS loopback address into a public endpoint", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "https://127.0.0.1/v1",
        allowLocalHttp: true,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it.each([
    "10.0.0.4",
    "172.16.0.4",
    "192.168.1.4",
    "169.254.169.254",
    "224.0.0.1",
    "0.0.0.0",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("rejects non-public literal address %s", async (address) => {
    const rawUrl = address.includes(":")
      ? `https://[${address}]/v1`
      : `https://${address}/v1`;
    await expect(
      approveCompatibleEndpoint({ rawUrl, allowLocalHttp: false }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it.each(["3fff::1", "100::1", "64:ff9b:1::1", "5f00::1"])(
    "rejects current non-globally-reachable IANA IPv6 special-purpose range %s",
    async (address) => {
      await expect(
        approveCompatibleEndpoint({
          rawUrl: `https://[${address}]/v1`,
          allowLocalHttp: false,
        }),
      ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
    },
  );

  it.each(["4000::1", "fec0::1", "3ffe::1", "2d00::1"])(
    "rejects IPv6 space outside current global-unicast allocations: %s",
    async (address) => {
      await expect(
        approveCompatibleEndpoint({
          rawUrl: `https://[${address}]/v1`,
          allowLocalHttp: false,
        }),
      ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
    },
  );

  it.each(["192.0.1.1", "192.18.0.1", "192.88.1.1"])(
    "does not broaden exact IPv4 special-purpose prefixes to %s",
    async (address) => {
      const endpoint = await approveCompatibleEndpoint({
        rawUrl: `https://${address}/v1`,
        allowLocalHttp: false,
      });

      expect(endpoint.addresses).toEqual([{ address, family: 4 }]);
    },
  );

  it.each(["192.0.0.9", "192.0.0.10"])(
    "accepts the current globally reachable IPv4 exception %s",
    async (address) => {
      const endpoint = await approveCompatibleEndpoint({
        rawUrl: `https://${address}/v1`,
        allowLocalHttp: false,
      });

      expect(endpoint.addresses).toEqual([{ address, family: 4 }]);
    },
  );

  it.each([
    "2001:1::1",
    "2001:1::2",
    "2001:1::3",
    "2001:3::1",
    "2001:4:112::1",
    "2001:20::1",
    "2001:30::1",
    "2620:4f:8000::1",
  ])(
    "accepts a current globally reachable IPv6 exception: %s",
    async (address) => {
      const endpoint = await approveCompatibleEndpoint({
        rawUrl: `https://[${address}]/v1`,
        allowLocalHttp: false,
      });

      expect(endpoint.addresses).toEqual([{ address, family: 6 }]);
    },
  );

  it("accepts an ordinary globally routable IPv6 address", async () => {
    const endpoint = await approveCompatibleEndpoint({
      rawUrl: "https://[2606:4700:4700::1111]/v1",
      allowLocalHttp: false,
    });

    expect(endpoint.addresses).toEqual([
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("rejects mixed DNS answers when one IPv6 answer is a special-purpose range", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "https://mixed-ipv6.example.com/v1",
        allowLocalHttp: false,
        lookup: jest.fn().mockResolvedValue([
          { address: "2606:4700:4700::1111", family: 6 },
          { address: "3fff::1", family: 6 },
        ]),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it("rejects remote HTTP with the fixed remote-HTTPS error even when local HTTP is allowed", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://gateway.example.com/v1",
        allowLocalHttp: true,
        lookup: publicLookup("93.184.216.34"),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_INVALID_ENDPOINT",
      message:
        "Remote provider endpoints must use HTTPS; HTTP is limited to explicit loopback.",
    });
  });

  it("classifies a private HTTP address as non-public before HTTP opt-in", async () => {
    await expect(
      approveCompatibleEndpoint({
        rawUrl: "http://10.0.0.4:8080/v1",
        allowLocalHttp: true,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
  });

  it("rejects a hostname when any DNS answer is non-public", async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);

    await expect(
      approveCompatibleEndpoint({
        rawUrl: "https://mixed.example.com/v1",
        allowLocalHttp: false,
        lookup,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_NOT_PUBLIC" });
    expect(lookup).toHaveBeenCalledWith("mixed.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("keeps fixed errors free of the raw unsafe URL", async () => {
    const unsafe = "https://user:top-secret@gateway.example.com/v1?token=abc";
    try {
      await approveCompatibleEndpoint({
        rawUrl: unsafe,
        allowLocalHttp: false,
        lookup: publicLookup(),
      });
      throw new Error("expected endpoint approval to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(unsafe);
    }
  });

  it("allows callers to inject DNS lookup instead of using the network", async () => {
    const lookup = publicLookup("2001:4860:4860::8888", 6);
    await approveCompatibleEndpoint({
      rawUrl: "https://ipv6.example.com/v1",
      allowLocalHttp: false,
      lookup,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(nodeLookup).toBeDefined();
  });
});

describe("Qwen pay-as-you-go endpoint construction", () => {
  it.each([
    [
      "china-beijing" as const,
      undefined,
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ],
    [
      "us-virginia" as const,
      undefined,
      "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    ],
    [
      "china-hongkong" as const,
      "cn-workspace",
      "https://cn-workspace.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1",
    ],
    [
      "singapore" as const,
      "ws-123",
      "https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    ],
    [
      "japan-tokyo" as const,
      "tokyo-workspace",
      "https://tokyo-workspace.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1",
    ],
    [
      "germany-frankfurt" as const,
      "frankfurt-workspace",
      "https://frankfurt-workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1",
    ],
  ])("maps %s to the documented endpoint", (region, workspaceId, expected) => {
    expect(buildQwenPaygEndpoint({ region, workspaceId }).toString()).toBe(
      expected,
    );
  });

  it.each(["", "bad_workspace", "UPPERCASE", "a".repeat(64)])(
    "rejects an unsafe workspace label: %s",
    (workspaceId) => {
      expect(() =>
        buildQwenPaygEndpoint({ region: "singapore", workspaceId }),
      ).toThrow();
    },
  );

  it("requires a workspace ID for workspace-host regions", () => {
    expect(() => buildQwenPaygEndpoint({ region: "china-hongkong" })).toThrow();
  });
});
