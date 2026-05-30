package com.chris.unbacd.web;

import java.util.List;

public final class WatchLogic {

    private WatchLogic() {}

    public static final int[] AU_BEER_VOLUME_VALUES = new int[] {
            115, 140, 170, 200, 285, 330, 375, 425, 500, 570, 1140
    };

    public static final class BeerSnapshot {
        public final long checkinId;
        public final String beerName;
        public final long createdAtMs;
        public final boolean phantom;

        public BeerSnapshot(long checkinId, String beerName, long createdAtMs, boolean phantom) {
            this.checkinId = checkinId;
            this.beerName = beerName;
            this.createdAtMs = createdAtMs;
            this.phantom = phantom;
        }
    }

    public static boolean isDeleteSuccessStatus(int code) {
        return (code >= 200 && code < 300) || code == 404 || code == 410;
    }

    public static boolean canAttemptRemoteDelete(long checkinId) {
        return checkinId != 0L;
    }

    public static boolean shouldShowDeleteFailureToast(boolean localRemoved, int code, boolean networkError) {
        if (localRemoved) return false;
        return networkError || !isDeleteSuccessStatus(code);
    }

    public static int nearestBeerVolumeIndex(int volumeMl) {
        if (AU_BEER_VOLUME_VALUES.length == 0) return 0;
        int bestIndex = 0;
        int bestDelta = Integer.MAX_VALUE;
        for (int i = 0; i < AU_BEER_VOLUME_VALUES.length; i++) {
            int delta = Math.abs(AU_BEER_VOLUME_VALUES[i] - volumeMl);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    public static Integer beerVolumeFromSizeName(String text) {
        if (text == null) return null;
        String normalized = text.toLowerCase(java.util.Locale.US);

        if (normalized.contains("small") || normalized.contains("tasmania")) return 115;
        if (normalized.contains("pony")) return 140;
        if (normalized.contains("bobby")) return 170;
        if (normalized.contains("butcher")) return 200;
        if (normalized.contains("middy") || normalized.contains("middie")
                || normalized.contains("pot") || normalized.contains("half")) return 285;
        if (normalized.contains("euro") || normalized.contains("bottle") || normalized.contains("stubby")) return 330;
        if (normalized.contains("can") || normalized.contains("tinnie")) return 375;
        if (normalized.contains("schooner")) return 425;
        if (normalized.contains("pint")) return 570;
        if (normalized.contains("jug")) return 1140;

        return null;
    }

    public static int findRemovalIndex(List<BeerSnapshot> items, BeerSnapshot target) {
        if (items == null || target == null) return -1;

        if (target.checkinId != 0L) {
            for (int i = 0; i < items.size(); i++) {
                BeerSnapshot it = items.get(i);
                if (it != null && it.checkinId == target.checkinId) return i;
            }
        }

        for (int i = 0; i < items.size(); i++) {
            BeerSnapshot it = items.get(i);
            if (it == null) continue;
            boolean sameTime = it.createdAtMs > 0 && it.createdAtMs == target.createdAtMs;
            boolean sameName = it.beerName != null && target.beerName != null
                    && it.beerName.equalsIgnoreCase(target.beerName);
            boolean sameManual = it.phantom == target.phantom;
            if (sameTime && sameName && sameManual) return i;
        }

        return -1;
    }
}
