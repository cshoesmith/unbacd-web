package com.chris.unbacd.web;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class WatchLogicTest {

    @Test
    public void deleteSuccessStatus_accepts2xx404410() {
        assertTrue(WatchLogic.isDeleteSuccessStatus(200));
        assertTrue(WatchLogic.isDeleteSuccessStatus(204));
        assertTrue(WatchLogic.isDeleteSuccessStatus(404));
        assertTrue(WatchLogic.isDeleteSuccessStatus(410));

        assertFalse(WatchLogic.isDeleteSuccessStatus(400));
        assertFalse(WatchLogic.isDeleteSuccessStatus(401));
        assertFalse(WatchLogic.isDeleteSuccessStatus(500));
    }

        @Test
        public void beerVolumeValues_includeAustralianServingSizes() {
                assertArrayEquals(
                                new int[] { 115, 140, 170, 200, 285, 330, 375, 425, 500, 570, 1140 },
                                WatchLogic.AU_BEER_VOLUME_VALUES
                );
        }

        @Test
        public void beerVolumeFromSizeName_mapsAustralianNames() {
                assertEquals(Integer.valueOf(115), WatchLogic.beerVolumeFromSizeName("small Tasmania"));
                assertEquals(Integer.valueOf(140), WatchLogic.beerVolumeFromSizeName("pony"));
                assertEquals(Integer.valueOf(170), WatchLogic.beerVolumeFromSizeName("bobby"));
                assertEquals(Integer.valueOf(200), WatchLogic.beerVolumeFromSizeName("butcher"));
                assertEquals(Integer.valueOf(285), WatchLogic.beerVolumeFromSizeName("pot middy"));
                assertEquals(Integer.valueOf(425), WatchLogic.beerVolumeFromSizeName("schooner NSW"));
                assertEquals(Integer.valueOf(570), WatchLogic.beerVolumeFromSizeName("pint"));
                assertEquals(Integer.valueOf(1140), WatchLogic.beerVolumeFromSizeName("jug"));
        }

        @Test
        public void nearestBeerVolumeIndex_matchesSchoonerAndJug() {
                assertEquals(7, WatchLogic.nearestBeerVolumeIndex(425));
                assertEquals(7, WatchLogic.nearestBeerVolumeIndex(440));
                assertEquals(10, WatchLogic.nearestBeerVolumeIndex(1140));
        }

        @Test
        public void canAttemptRemoteDelete_allowsLargeNegativePhantomIds() {
                assertTrue(WatchLogic.canAttemptRemoteDelete(-1760000000000L));
                assertTrue(WatchLogic.canAttemptRemoteDelete(12345));
                assertFalse(WatchLogic.canAttemptRemoteDelete(0));
        }

        @Test
        public void findRemovalIndex_matchesLargeNegativePhantomId() {
                List<WatchLogic.BeerSnapshot> items = Arrays.asList(
                                new WatchLogic.BeerSnapshot(-1760000000000L, "Manual IPA", 1000, true),
                                new WatchLogic.BeerSnapshot(-1760000000001L, "Manual Lager", 2000, true)
                );

                int idx = WatchLogic.findRemovalIndex(items,
                                new WatchLogic.BeerSnapshot(-1760000000001L, "wrong", 9999, true));

                assertEquals(1, idx);
        }

        @Test
        public void shouldShowDeleteFailureToast_suppressesFailuresAfterOptimisticRemoval() {
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(true, 500, false));
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(true, -1, true));
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(true, 0, false));
        }

        @Test
        public void shouldShowDeleteFailureToast_showsWhenNothingWasRemovedAndDeleteFailed() {
                assertTrue(WatchLogic.shouldShowDeleteFailureToast(false, 500, false));
                assertTrue(WatchLogic.shouldShowDeleteFailureToast(false, -1, true));
                assertTrue(WatchLogic.shouldShowDeleteFailureToast(false, 0, false));
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(false, 404, false));
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(false, 410, false));
                assertFalse(WatchLogic.shouldShowDeleteFailureToast(false, 204, false));
        }

    @Test
    public void findRemovalIndex_prefersCheckinId() {
        List<WatchLogic.BeerSnapshot> items = Arrays.asList(
                new WatchLogic.BeerSnapshot(10, "A", 1000, true),
                new WatchLogic.BeerSnapshot(11, "B", 2000, true),
                new WatchLogic.BeerSnapshot(12, "C", 3000, false)
        );

        int idx = WatchLogic.findRemovalIndex(items,
                new WatchLogic.BeerSnapshot(11, "wrong", 9999, false));

        assertEquals(1, idx);
    }

    @Test
    public void findRemovalIndex_fallbacksByTimeNameManual() {
        List<WatchLogic.BeerSnapshot> items = Arrays.asList(
                new WatchLogic.BeerSnapshot(-1, "Hazy IPA", 123456, true),
                new WatchLogic.BeerSnapshot(-1, "Lager", 123457, true)
        );

        int idx = WatchLogic.findRemovalIndex(items,
                new WatchLogic.BeerSnapshot(-1, "hazy ipa", 123456, true));

        assertEquals(0, idx);
    }

    @Test
    public void findRemovalIndex_returnsMinusOneWhenNoMatch() {
        List<WatchLogic.BeerSnapshot> items = Arrays.asList(
                new WatchLogic.BeerSnapshot(1, "A", 1000, true)
        );

        int idx = WatchLogic.findRemovalIndex(items,
                new WatchLogic.BeerSnapshot(2, "B", 2000, true));

        assertEquals(-1, idx);
    }
}
