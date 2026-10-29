// Bluetooth Low Energy printer models whose print service has been verified on real
// hardware (see PRINTING.md, "Verifying a printer"). Automatic detection only configures
// a printer that matches an entry here; anything else needs Manual configuration.
//
// Add an entry ONLY with UUIDs read from the actual printer and a confirmed test page.
// Never copy UUIDs from another model, a forum or a guess: a wrong entry would make
// detection claim a printer works when it does not.
export type VerifiedBlePrinter={
  model:string;
  namePrefixes:string[];        // Bluetooth name prefixes seen during verification
  serviceUuid:string;           // full 128-bit UUID
  characteristicUuid:string;    // writable characteristic, full 128-bit UUID
  verifiedOn:string;            // tablet, Android and Chrome versions, date
};

export const VERIFIED_BLE_PRINTERS:readonly VerifiedBlePrinter[]=[];
