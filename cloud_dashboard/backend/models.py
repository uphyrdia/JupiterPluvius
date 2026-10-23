from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Profile = Literal["NORMAL", "CONSERVATIVE", "HIGH_DEMAND"]
DeviceId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Index = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Telemetry(StrictModel):
    schema_version: Literal[1]
    device_id: DeviceId
    boot_id: Annotated[str, Field(min_length=1, max_length=64)]
    sequence: Annotated[int, Field(ge=0, le=4294967295)]
    temperature_c: Annotated[float, Field(ge=-40, le=125, allow_inf_nan=False)] | None = None
    humidity_percent: Index | None = None
    soil_moisture_index: Index | None = None
    light_index: Index | None = None
    soil_adc_raw: Annotated[int, Field(ge=0, le=4095)] | None = None
    light_adc_raw: Annotated[int, Field(ge=0, le=4095)] | None = None
    reservoir_state: Literal["OK", "LOW", "UNKNOWN"] = "UNKNOWN"
    watering_active: bool | None = None
    led_brightness: Annotated[int, Field(ge=0, le=255)] | None = None
    active_profile: Profile | None = None
    faults: Annotated[list[Annotated[str, Field(min_length=1, max_length=80)]], Field(max_length=20)] = Field(default_factory=list)
    sample_age_ms: Annotated[int, Field(ge=0, le=86400000)]
    test_data: bool = False

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("schema_version must be the integer 1")
        return value


class Advice(StrictModel):
    care_profile: Profile
    advisory_code: Literal["NONE", "LOW_LIGHT", "REFILL_RESERVOIR", "CHECK_SENSOR", "CHECK_WATER_DELIVERY"]
    reason: Annotated[str, Field(min_length=1, max_length=160, pattern=r"\S")]


class Acknowledgement(StrictModel):
    recommendation_id: Annotated[str, Field(min_length=1, max_length=64)]
    result: Literal["APPLIED", "REJECTED"]
    origin: Literal["MCXC444"]
    reason: Annotated[str, Field(max_length=160)] | None = None


class SimulationControl(StrictModel):
    scenario: Literal["NORMAL", "DRYING_SOIL", "LOW_RESERVOIR", "SENSOR_FAULT"] | None = None
    paused: bool | None = None
